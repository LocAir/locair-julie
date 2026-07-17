const Stripe = require('stripe');
const { getSupabase }         = require('./_lib/supabase');
const { resolveCityByAddress } = require('./_lib/city');
const { getAvailability }     = require('./_lib/stock');
const { isValidDate, addDays } = require('./_lib/dates');
const { calcTieredPrice }      = require('./_lib/pricing');
const { CGV_VERSION, ACCEPTANCE_TYPES } = require('./_lib/legal');
const { matchPromoPct } = require('./_lib/promo');

const calcBase = calcTieredPrice;

const PROMO_CODES  = { LOCAIR10: 10, LOCA10: 10 };
// Doit rester synchronisé avec INSTALL_FEE dans index.html (prix affiché au
// client) — un écart entre les deux fait payer un montant différent de celui
// confirmé pendant la réservation.
const INSTALL_FEE  = 49;
// Codes postaux en zone standard (livraison 35 €)
// Tout autre code postal → tarif hors zone (95 €)
const ZONE_CP = new Set(['06000','06100','06200','06300','06700','06800','06230','06310']);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const data   = req.body || {};
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // Acceptation obligatoire des CGV/CGL et des conditions d'utilisation du
  // climatiseur — le bouton de paiement est déjà désactivé côté site tant que
  // ces deux cases ne sont pas cochées, mais ça ne protège que l'UI : sans ce
  // contrôle serveur, un appel direct à cette API pourrait créer un paiement
  // sans qu'aucune des deux acceptations n'ait jamais été donnée.
  if (data.cgv_accepted !== true || data.conditions_utilisation_accepted !== true) {
    return res.status(400).json({ error: 'Vous devez accepter les CGV et les conditions d\'utilisation avant de payer.' });
  }

  const duree = Math.max(7, parseInt(data.duree) || 7);
  const qty   = Math.min(5, Math.max(1, parseInt((data.quantite || '1').replace(/[^0-9]/g, '')) || 1));
  const baseCents     = calcBase(duree) * qty * 100;
  const isTech        = (data.installation || '').startsWith('Technicien');
  const installCents  = isTech ? INSTALL_FEE * 100 : 0;
  const promoCode     = (data.parrain_code || '').trim().toUpperCase();
  // Codes fixes (montant flat en euros) + codes "PRENOM10/20/30" personnalisés
  // (pourcentage du prix de base) envoyés automatiquement à la fin de chaque
  // location — voir _lib/promo.js.
  const promoPct       = matchPromoPct(promoCode, data.prenom);
  const promoDiscount = (PROMO_CODES[promoCode] || 0) * 100 + Math.round(baseCents * promoPct / 100);

  const dateDebut = (data.date || '').slice(0, 10);
  if (!isValidDate(dateDebut)) {
    return res.status(400).json({ error: 'Date de livraison invalide' });
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
    const disponibles = await getAvailability(supabase, city.id, dateDebut, dateFin);
    if (disponibles < qty) {
      return res.status(409).json({ error: 'Plus assez de climatiseurs disponibles pour ces dates', disponibles: Math.max(0, disponibles) });
    }
  } catch (err) {
    console.error('[Stock check checkout]', err.message);
    return res.status(500).json({ error: 'Erreur serveur stock' });
  }

  // Frais de livraison déterminés après résolution de l'adresse
  const deliveryFeeCents = ZONE_CP.has((data.code_postal || '').trim()) ? 35 * 100 : 95 * 100;
  const amountCents      = Math.max(0, baseCents + installCents + deliveryFeeCents - promoDiscount);

  if (!amountCents || amountCents < 10000) {
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
      const email = data.email.trim();
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
        hors_zone:    horsZone ? 'oui' : 'non',
        promo:        promoCode,
        customer_id:  customerId,
      },
    });

    const { data: insertedResa, error: insertErr } = await supabase.from('reservations').insert({
      city_id:                  city.id,
      hors_zone:                horsZone || false,
      ref:                      (data._ref || '').slice(0, 100),
      stripe_payment_intent_id: intent.id,
      stripe_customer_id:       customerId || null,
      prenom:                   (data.prenom  || '').slice(0, 200),
      nom:                      (data.nom     || '').slice(0, 200),
      email:                    (data.email   || '').slice(0, 200),
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
      statut:                   'en_attente',
      source:                   'site',
      source_channel:           (data.source || '').slice(0, 100) || null,
      type_client:              (data.type_client || '').toLowerCase().startsWith('pro') ? 'entreprise' : 'particulier',
      siret:                    (data.siret || '').replace(/\s/g, '').slice(0, 14) || null,
      parrain_code:             (data.parrain_code || '').slice(0, 100) || null,
      partenaire_id:            partenaireId,
      partenaire_commission_cents: partenaireCommissionCents,
      logement:                 (data.logement || '').slice(0, 100) || null,
      motifs:                   (data.motifs || '').slice(0, 500) || null,
      mkt_consent:              data.mkt_consent === 'Oui' || data.mkt_consent === true,
      cgv_accepted_at:          (data.cgv_accepted_at || null),
    }).select('id').single();

    if (insertErr) {
      console.error('[Reservation insert]', insertErr.message);
      await stripe.paymentIntents.cancel(intent.id).catch(e => console.error('[Stripe cancel]', e.message));
      return res.status(500).json({ error: 'Erreur serveur réservation' });
    }

    // Trace d'audit des deux acceptations (CGV/CGL + conditions d'utilisation) —
    // ne doit jamais faire échouer une réservation déjà payée si l'écriture
    // rate, mais son absence ne doit pas non plus passer inaperçue.
    try {
      await supabase.from('cgv_acceptations').insert([
        { reservation_id: insertedResa.id, type: ACCEPTANCE_TYPES.CGV_LOCATION,           version: CGV_VERSION, accepted_at: data.cgv_accepted_at || new Date().toISOString() },
        { reservation_id: insertedResa.id, type: ACCEPTANCE_TYPES.CONDITIONS_UTILISATION, version: CGV_VERSION, accepted_at: data.conditions_utilisation_accepted_at || new Date().toISOString() },
      ]);
    } catch (e) {
      console.error('[CGV acceptations]', e.message);
    }

    // Répartition par type de fenêtre (ex. 2 porte coulissante + 1 Vélux),
    // envoyée par le site quand la quantité de climatiseurs est > 1 — voir
    // reservation_fenetres dans schema.sql. Absente/vide pour une seule
    // fenêtre : reservations.fenetre suffit alors, rien à écrire ici.
    try {
      const detail = JSON.parse(data.fenetre_detail || '{}');
      const rows = Object.entries(detail)
        .filter(([type, qty]) => type && Number.isInteger(qty) && qty > 0)
        .map(([type, qty]) => ({ reservation_id: insertedResa.id, type: String(type).slice(0, 100), quantite: qty }));
      if (rows.length) await supabase.from('reservation_fenetres').insert(rows);
    } catch (e) {
      console.error('[reservation_fenetres insert]', e.message);
    }

    return res.status(200).json({ clientSecret: intent.client_secret, amountCents, customerId });
  } catch (err) {
    console.error('[Stripe intent]', err.message);
    return res.status(500).json({ error: 'Erreur serveur paiement' });
  }
};
