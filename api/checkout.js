const Stripe = require('stripe');
const { getSupabase }         = require('./_lib/supabase');
const { resolveCityByAddress } = require('./_lib/city');
const { getAvailability } = require('./_lib/stock');
const { isValidDate, addDays, todayParis } = require('./_lib/dates');
const { calcTieredPrice, getPricingConfig } = require('./_lib/pricing');
const { CGV_VERSION, ACCEPTANCE_TYPES } = require('./_lib/legal');
const { resolvePromotion, recordPromotionUsage } = require('./_lib/promotions');
const { getMatchingForfait } = require('./_lib/forfaits');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

// Doit rester synchronisé avec INSTALL_FEE / EXPRESS_FEE dans index.html
// (prix affiché au client) — un écart entre les deux fait payer un montant
// différent de celui confirmé pendant la réservation.
const INSTALL_FEE  = 80;
const EXPRESS_FEE  = 60; // surcoût livraison express J0 sous 2h

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  try {
    if (await isRateLimited(getSupabase(), `checkout:${ip}`)) return res.status(429).json({ error: 'Trop de tentatives, réessayez dans 15 minutes.' });
  } catch (rlErr) {
    console.error('[Checkout rateLimit]', rlErr.message);
  }

  const data   = req.body || {};
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // Acceptation obligatoire des CGV/CGL, des conditions d'utilisation du
  // climatiseur, et de l'autorisation de prélèvement en cas de retard — le
  // bouton de paiement est déjà désactivé côté site tant que ces trois cases
  // ne sont pas cochées, mais ça ne protège que l'UI : sans ce contrôle
  // serveur, un appel direct à cette API pourrait créer un paiement sans
  // qu'aucune des trois acceptations n'ait jamais été donnée.
  if (data.cgv_accepted !== true || data.conditions_utilisation_accepted !== true || data.retard_accepted !== true) {
    return res.status(400).json({ error: 'Vous devez accepter les CGV, les conditions d\'utilisation et l\'autorisation de prélèvement en cas de retard avant de payer.' });
  }

  // data.email && ... court-circuitait la validation si email vide →
  // une réservation sans email passait, aucun email de confirmation envoyé.
  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
    return res.status(400).json({ error: 'Adresse email requise et doit être valide' });
  }

  // Tarifs (panneau de contrôle admin, voir admin-pricing.js) chargés une
  // seule fois ici, réutilisés pour tout le reste du calcul — jamais
  // recalculés en dur, jamais désynchronisés du barème réellement affiché.
  const pricing = await getPricingConfig(getSupabase());
  const rawDuree = parseInt(data.duree) || pricing.duree_min_jours;
  const rawQty   = Math.min(5, Math.max(1, parseInt(String(data.quantite ?? '1').replace(/[^0-9]/g, '')) || 1));
  // Pack à prix fixe (ex. "Pack Sérénité Solo/Duo", voir admin-forfaits.js) —
  // ne s'applique que si la durée et la quantité demandées correspondent
  // EXACTEMENT à ce pack ; sinon on retombe silencieusement sur le tarif
  // dégressif normal ci-dessous. Le prix vient alors directement du forfait
  // (figé, jamais recalculé), pas de calcTieredPrice.
  const forfait = await getMatchingForfait(getSupabase(), { forfaitId: data.forfait_id, duree: rawDuree, quantite: rawQty });
  const duree = forfait ? forfait.duree_jours : Math.min(90, Math.max(pricing.duree_min_jours, rawDuree));
  const qty   = forfait ? forfait.quantite    : rawQty;
  const baseCents     = forfait ? forfait.prix_cents : calcTieredPrice(duree, pricing) * qty * 100;
  const isTech        = (data.installation || '').startsWith('Technicien');
  const installCents  = isTech ? INSTALL_FEE * 100 : 0;
  const promoCode     = (data.parrain_code || '').trim().toUpperCase();

  const dateDebut = (data.date || '').slice(0, 10);
  if (!isValidDate(dateDebut)) {
    return res.status(400).json({ error: 'Date de livraison invalide' });
  }
  if (dateDebut < todayParis()) {
    return res.status(400).json({ error: 'La date de livraison ne peut pas être dans le passé.' });
  }
  const dateFin  = addDays(dateDebut, duree);
  const supabase = getSupabase();
  let city;
  let horsZone = false;
  // Réservation apportée par un partenaire (conciergerie...) via son lien
  // d'affiliation (ex. locair.fr/?p=CODE) — voir index.html (capture du
  // paramètre d'URL) et migration_partenaires.sql.
  let partenaireId = null;
  let partenaireTaux = 0;

  try {
    const partenaireCode = (data.partenaire_code || '').trim().toLowerCase();
    if (partenaireCode) {
      const { data: partenaire } = await supabase
        .from('partenaires').select('id, taux_commission_pct').eq('code', partenaireCode).eq('actif', true).maybeSingle();
      if (partenaire) { partenaireId = partenaire.id; partenaireTaux = partenaire.taux_commission_pct; } // commission calculée ci-dessous, une fois amountCents connu
    }
    city = await resolveCityByAddress(supabase, data.adresse, data.code_postal);
    if (!city) {
      // Code postal non couvert : accepter la commande en la marquant hors zone
      // pour traitement manuel — l'admin verra le badge dans l'onglet Réservations.
      const { data: fallback } = await supabase
        .from('cities').select('id').eq('actif', true).order('id').limit(1).maybeSingle();
      city = fallback;
      horsZone = true;
      if (!city) {
        return res.status(422).json({ error: 'Aucune ville configurée pour recevoir cette commande — contacte-nous.' });
      }
    }
  } catch (err) {
    console.error('[Checkout resolveCity]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }

  // Blocage serveur d'une NOUVELLE réservation quand la ville est en mode
  // complet (même règle que le blocage client, index.html openModal) — le
  // blocage côté site peut être contourné (appel direct à l'API), celui-ci
  // ne peut pas l'être. Jamais appliqué à une commande hors zone (ville de
  // secours choisie arbitrairement, sans rapport avec le vrai stock du
  // secteur non couvert) ni à une prolongation (checkout-prolong.js), qui
  // ne consomme pas d'appareil supplémentaire.
  if (!horsZone) {
    try {
      const dispo = await getAvailability(supabase, city.id, dateDebut, dateFin);
      if (dispo < qty) {
        return res.status(409).json({ error: 'Plus assez d\'appareils disponibles pour ce créneau.' });
      }
    } catch (err) {
      console.error('[Checkout soldOut]', err.message);
      // Ne pas continuer en cas d'erreur DB : risque de surréservation silencieuse.
      return res.status(503).json({ error: 'Impossible de vérifier la disponibilité pour le moment. Réessayez dans quelques instants.' });
    }
  }

  // Offres/codes promo (panneau de contrôle admin, voir admin-promotions.js)
  // — cherche d'abord une offre configurée en base ; si aucune ne
  // correspond, retombe sur l'ancien système "PRENOM10/20/30" (parrainage,
  // relance dormants) pour ne jamais casser un code déjà envoyé à un client.
  // Réservé aux nouvelles réservations (pas de code promo sur une
  // prolongation, voir prolong-pay.js) — et jamais combiné à un forfait à
  // prix fixe (déjà un prix figé, une remise en plus n'aurait pas de sens).
  const promoResult   = forfait
    ? { discountCents: 0, promotionId: null, source: null }
    : await resolvePromotion(supabase, {
        code: promoCode, prenom: data.prenom, email: data.email,
        baseCents, days: duree, cityId: city.id, dateDebut,
      });
  const promoDiscount = promoResult.discountCents;

  // Frais de livraison : 60 € si le code postal est couvert par la ville résolue
  // (city.postal_codes en base), 120 € sinon — y compris pour les commandes hors zone.
  const deliveryFeeCents = (city.postal_codes || []).includes((data.code_postal || '').trim()) ? 60 * 100 : 120 * 100;
  // Surcoût livraison express J0 sous 2h (+60 €) — activé côté client par la
  // carte "Express" dans le modal, transmis via data.express === true.
  const expressCents     = data.express === true ? EXPRESS_FEE * 100 : 0;
  const amountCents      = Math.max(0, baseCents + installCents + deliveryFeeCents + expressCents - promoDiscount);

  if (!amountCents || amountCents < 5000) {
    return res.status(400).json({ error: 'Montant invalide' });
  }

  // Commission partenaire figée sur le montant payé par le client — ne bouge
  // pas rétroactivement si le taux du partenaire change ensuite.
  const partenaireCommissionCents = partenaireId ? Math.round(amountCents * partenaireTaux / 100) : 0;

  try {
    // Créer ou retrouver le Customer Stripe — nécessaire pour l'autorisation de prélèvement
    // off-session en cas de retard de restitution (empreinte carte, sans blocage de fonds)
    let customerId = '';
    if (data.email) {
      const email = data.email.trim().toLowerCase();
      const existing = await stripe.customers.list({ email, limit: 1 });
      if (existing.data.length > 0) {
        customerId = existing.data[0].id;
        const c = existing.data[0];
        if (!c.name && (data.prenom || data.nom)) {
          await stripe.customers.update(customerId, {
            name:  [data.prenom, data.nom].filter(Boolean).join(' '),
            phone: data.tel || c.phone || undefined,
          });
        }
      } else {
        const customer = await stripe.customers.create({
          email,
          name:  [data.prenom, data.nom].filter(Boolean).join(' ') || undefined,
          phone: data.tel || undefined,
          metadata: { adresse: (data.adresse || '').slice(0, 500) },
        });
        customerId = customer.id;
      }
    }

    const intent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      setup_future_usage: 'off_session',
      customer:      customerId || undefined,
      receipt_email: data.email || undefined,
      description: [
        `Loc'Air — ${qty > 1 ? qty + 'x ' : ''}${duree} jour${duree > 1 ? 's' : ''}`,
        data.date              ? `Livraison ${data.date}` : '',
        data.creneau_livraison || '',
        data.adresse           || '',
      ].filter(Boolean).join(' · ').slice(0, 1000),
      metadata: {
        ref:          (data._ref              || '').slice(0, 500),
        prenom:       (data.prenom            || '').slice(0, 500),
        nom:          (data.nom               || '').slice(0, 500),
        tel:          (data.tel               || '').slice(0, 500),
        adresse:      (data.adresse           || '').slice(0, 500),
        duree:        String(duree),
        quantite:     String(qty),
        date:         (data.date              || '').slice(0, 500),
        creneau:      (data.creneau_livraison || '').slice(0, 500),
        installation: (data.installation      || '').slice(0, 500),
        fenetre:      (data.fenetre           || '').slice(0, 500),
        etage:        (data.etage             || '').slice(0, 500),
        ascenseur:    (data.ascenseur         || '').slice(0, 500),
        frais_livraison: String(deliveryFeeCents / 100) + ' EUR',
        express:      expressCents > 0 ? 'oui' : 'non',
        hors_zone:    horsZone ? 'oui' : 'non',
        promo:        promoCode,
        forfait:      forfait ? forfait.nom.slice(0, 200) : '',
        customer_id:  customerId,
        date_recup_souhaitee: (data.date_recuperation_souhaitee || '').slice(0, 10),
        creneau_recup:        (data.creneau_recuperation        || '').slice(0, 50),
      },
    }, { idempotencyKey: `checkout-${(data._ref || '').slice(0, 40)}-${amountCents}` });

    const { data: insertedResa, error: insertErr } = await supabase.from('reservations').insert({
      city_id:                  city.id,
      hors_zone:                horsZone || false,
      express:                  expressCents > 0,
      ref:                      (data._ref || '').slice(0, 100),
      stripe_payment_intent_id: intent.id,
      stripe_customer_id:       customerId || null,
      prenom:                   (data.prenom  || '').slice(0, 200),
      nom:                      (data.nom     || '').slice(0, 200),
      // En minuscules : toutes les recherches ultérieures par email (connexion
      // espace client, prolongation, rattachement admin) comparent en
      // minuscules — un email stocké avec des majuscules ne matchait plus
      // jamais ces recherches (voir client-login.js, prolong-lookup.js).
      email:                    (data.email   || '').trim().toLowerCase().slice(0, 200),
      tel:                      (data.tel     || '').slice(0, 50),
      tel_secondaire:           (data.tel_secondaire || '').slice(0, 50) || null,
      raison_sociale:           (data.raison_sociale || '').slice(0, 300) || null,
      adresse:                  (data.adresse || '').slice(0, 500),
      etage:                    (data.etage        || '').slice(0, 50),
      ascenseur:                (data.ascenseur    || '').slice(0, 50),
      fenetre:                  (data.fenetre      || '').slice(0, 100),
      fenetre_photo_path:       ((data.fenetre_photo_path || '').startsWith('window-photos/') ? data.fenetre_photo_path.slice(0, 500) : null),
      installation:             (data.installation || '').slice(0, 100),
      instructions_acces:       (data.instructions_acces || '').slice(0, 1000),
      creneau:                  (data.creneau_livraison || '').slice(0, 500),
      date_debut:               dateDebut,
      date_fin:                 dateFin,
      quantite:                 qty,
      prix_total_cents:         amountCents,
      forfait_id:               forfait ? forfait.id : null,
      statut:                   'en_attente',
      source:                   'site',
      lang:                     ['fr','en','zh','ru'].includes(data.lang) ? data.lang : 'fr',
      source_channel:           (data.source || '').slice(0, 100) || null,
      type_client:              (data.type_client || '').toLowerCase().startsWith('pro') ? 'entreprise' : 'particulier',
      siret:                    (data.siret || '').replace(/\s/g, '').slice(0, 14) || null,
      parrain_code:             (data.parrain_code || '').slice(0, 100) || null,
      partenaire_id:            partenaireId,
      partenaire_commission_cents: partenaireCommissionCents,
      logement:                 (data.logement || '').slice(0, 100) || null,
      motifs:                   (data.motifs || '').slice(0, 500) || null,
      creneau_recuperation:     ['8h – 10h', '10h – 12h'].includes(data.creneau_recuperation) ? data.creneau_recuperation : null,
      date_recuperation_souhaitee: (() => { const v = (data.date_recuperation_souhaitee || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= dateFin ? v : null; })(),
      mkt_consent:              data.mkt_consent === 'Oui' || data.mkt_consent === true,
      cgv_accepted_at:          new Date().toISOString(),
    }).select('id').single();

    if (insertErr) {
      console.error('[Reservation insert]', insertErr.message);
      await stripe.paymentIntents.cancel(intent.id).catch(e => console.error('[Stripe cancel]', e.message));
      return res.status(500).json({ error: 'Erreur serveur réservation' });
    }

    // Trace d'audit des trois acceptations (CGV/CGL + conditions d'utilisation
    // + autorisation de prélèvement en cas de retard) — ne doit jamais faire
    // échouer une réservation déjà payée si l'écriture rate, mais son absence
    // ne doit pas non plus passer inaperçue.
    try {
      await supabase.from('cgv_acceptations').insert([
        { reservation_id: insertedResa.id, type: ACCEPTANCE_TYPES.CGV_LOCATION,           version: CGV_VERSION, accepted_at: new Date().toISOString() },
        { reservation_id: insertedResa.id, type: ACCEPTANCE_TYPES.CONDITIONS_UTILISATION, version: CGV_VERSION, accepted_at: new Date().toISOString() },
        { reservation_id: insertedResa.id, type: ACCEPTANCE_TYPES.AUTORISATION_RETARD,    version: CGV_VERSION, accepted_at: new Date().toISOString() },
      ]);
    } catch (e) {
      console.error('[CGV acceptations]', e.message);
    }

    // Compte l'utilisation de l'offre (pour le suivi "X fois par client" et
    // le nombre d'utilisations restant) — uniquement pour un code réellement
    // géré par le panneau admin (promoResult.promotionId), pas pour un code
    // "PRENOM10/20/30" du filet de secours qui n'est pas suivi en base.
    if (promoResult.promotionId) {
      await recordPromotionUsage(supabase, {
        promotionId: promoResult.promotionId, reservationId: insertedResa.id,
        email: data.email, montantRemiseCents: promoResult.discountCents,
      });
    }

    // Répartition par type de fenêtre (ex. 2 porte coulissante + 1 Vélux),
    // envoyée par le site quand la quantité de climatiseurs est > 1 — voir
    // reservation_fenetres dans schema.sql. Absente/vide pour une seule
    // fenêtre : reservations.fenetre suffit alors, rien à écrire ici.
    try {
      const detail = typeof data.fenetre_detail === 'object' && data.fenetre_detail !== null
        ? data.fenetre_detail
        : JSON.parse(typeof data.fenetre_detail === 'string' ? data.fenetre_detail || '{}' : '{}');
      const rows = Object.entries(detail)
        .filter(([type, qty]) => type && Number.isInteger(qty) && qty > 0)
        .map(([type, qty]) => ({ reservation_id: insertedResa.id, type: String(type).slice(0, 100), quantite: qty }));
      if (rows.length > 10) {
        console.error('[reservation_fenetres] trop d\'entrées:', rows.length);
      } else if (rows.length) {
        await supabase.from('reservation_fenetres').insert(rows);
      }
    } catch (e) {
      console.error('[reservation_fenetres insert]', e.message);
    }

    return res.status(200).json({ clientSecret: intent.client_secret, amountCents });
  } catch (err) {
    console.error('[Stripe intent]', err.message);
    await recordFailedAttempt(supabase, `checkout:${ip}`).catch(() => {});
    return res.status(500).json({ error: 'Erreur serveur paiement' });
  }
};
