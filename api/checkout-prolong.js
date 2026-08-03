const Stripe = require('stripe');
const { getSupabase }     = require('./_lib/supabase');
const { resolveCityById } = require('./_lib/city');
const { isValidDate, addDays } = require('./_lib/dates');
const { calcTieredPrice } = require('./_lib/pricing');
const { CGV_VERSION, ACCEPTANCE_TYPES } = require('./_lib/legal');
const { getEffectiveDateFin } = require('./_lib/reservations');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

const calcBase = calcTieredPrice;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseRL = getSupabase();
  const ip = getClientIp(req);
  if (await isRateLimited(supabaseRL, `checkout-prolong:${ip}`)) {
    return res.status(429).json({ error: 'Trop de tentatives, réessayez dans 15 minutes.' });
  }

  const data   = req.body || {};
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // Même contrôle serveur que /api/checkout — le bouton de paiement est déjà
  // désactivé côté site tant que la case CGV n'est pas cochée, mais ça ne
  // protège que l'UI.
  if (data.cgv_accepted !== true) {
    return res.status(400).json({ error: 'Vous devez accepter les CGV avant de payer.' });
  }

  let jours            = Math.max(1, parseInt(data.jours) || 1);
  const clientOrigDays = Math.max(0, parseInt(data.original_days) || 0);
  let qty              = Math.min(5, Math.max(1, parseInt(data.quantite) || 1));

  // Prix calculé avec l'origDays du client pour l'instant — recalculé ci-dessous
  // à partir des dates réelles en DB pour empêcher toute manipulation du prix.
  // Filet de sécurité : depuis la suppression du palier 3-6 jours, un incrément
  // négatif ne devrait plus survenir pour une nouvelle réservation (7 jours
  // minimum), mais reste possible pour une prolongation d'une réservation plus
  // ancienne (avant ce changement) dont origDays < 7. Dans ce cas, on facture
  // le tarif moyen du nouveau palier plutôt qu'un montant négatif ou nul.
  function _safeIncrement(origDays, extra) {
    const delta = calcBase(origDays + extra) - calcBase(origDays);
    if (delta > 0) return delta;
    return Math.round(calcBase(origDays + extra) / (origDays + extra)) * extra;
  }
  let amountCents = (clientOrigDays > 0
    ? _safeIncrement(clientOrigDays, jours)
    : calcBase(jours)) * qty * 100;
  // Saisie brute du client (simple <input type="date">, jamais pré-remplie
  // ni verrouillée côté site) — sert uniquement à valider le format avant
  // la requête DB ci-dessous. Une fois orig retrouvé, orig.date_fin écrase
  // cette valeur (voir plus bas) : source de vérité unique.
  let extDateDebut     = (data.date_fin_initiale     || '').slice(0, 10);
  const extDateFin     = (data.date_recuperation_iso || '').slice(0, 10);
  if (!isValidDate(extDateDebut) || !isValidDate(extDateFin) || extDateFin <= extDateDebut) {
    await recordFailedAttempt(supabaseRL, `checkout-prolong:${ip}`).catch(() => {});
    return res.status(400).json({ error: 'Dates de prolongation invalides' });
  }
  const joursCalc = Math.round((new Date(extDateFin+'T00:00:00Z') - new Date(extDateDebut+'T00:00:00Z')) / 86400000);
  if (joursCalc < 1) {
    await recordFailedAttempt(supabaseRL, `checkout-prolong:${ip}`).catch(() => {});
    return res.status(400).json({ error: 'Durée de prolongation invalide' });
  }
  jours = joursCalc;
  amountCents = (clientOrigDays > 0 ? _safeIncrement(clientOrigDays, jours) : calcBase(jours)) * qty * 100;
  const today = new Date().toISOString().slice(0, 10);
  if (extDateDebut < today) {
    await recordFailedAttempt(supabaseRL, `checkout-prolong:${ip}`).catch(() => {});
    return res.status(422).json({ error: 'La date de fin initiale est déjà passée — impossible de prolonger.' });
  }

  const supabase = getSupabase();
  let city;
  let orig; // récupérée dans le 1er bloc try, réutilisée dans le 2e (insert) plus bas
  let partenaireCommissionCents = 0;
  try {
    // Une prolongation ne collecte pas une nouvelle adresse — on reprend la
    // même zone que la réservation d'origine du client, retrouvée par email
    // (pas par adresse : plus fiable, et cohérent avec la logique de
    // rattachement déjà utilisée dans confirmReservation). Si un numéro de
    // commande est fourni (ex. lien depuis l'email "avant fin de location"),
    // il précise la recherche — utile si le client a plusieurs réservations
    // passées avec la même adresse email.
    if (!data.email) {
      return res.status(400).json({ error: 'Email requis pour retrouver ta réservation' });
    }
    // .eq('statut','confirmee') indispensable : sans lui, une réservation plus
    // récente mais annulée/en attente sous le même email (tentative abandonnée,
    // doublon) passe devant la vraie réservation active dans le tri par date de
    // création — la prolongation hérite alors de la mauvaise adresse/logistique
    // et ne se rattache jamais à la bonne réservation. Même filtre déjà en
    // place côté admin (admin-reservations.js, action 'lookup_prolongation').
    let origQuery = supabase
      .from('reservations').select('id, city_id, tel_secondaire, hors_zone, date_debut, date_fin, quantite, etage, ascenseur, fenetre, fenetre_photo_path, installation, instructions_acces, creneau, logement, partenaire_id')
      .ilike('email', String(data.email).trim())
      .not('source', 'eq', 'site_prolongation')
      .eq('statut', 'confirmee');
    if (data.ref) origQuery = origQuery.eq('ref', String(data.ref).trim().toUpperCase());
    ({ data: orig } = await origQuery.order('created_at', { ascending: false }).limit(1).maybeSingle());
    city = orig ? await resolveCityById(supabase, orig.city_id) : null;
    if (!city) {
      return res.status(422).json({ error: 'Réservation d\'origine introuvable — contacte-nous directement pour prolonger.' });
    }
    if (orig?.quantite) {
      qty = Math.min(5, Math.max(1, orig.quantite));
    }
    // La date "fin de contrat actuelle" tapée par le client ne fait jamais foi
    // une fois la réservation d'origine retrouvée : sans cette correction, une
    // simple erreur de frappe crée une prolongation décalée par rapport à la
    // vraie date_fin — la mission de récupération d'origine reste plantée à
    // l'ancienne date, et confirmReservation() (qui rattache l'appareil via
    // une recherche sur date_fin=date_debut) ne retrouve jamais la bonne
    // réservation à transférer, immobilisant un appareil neuf pour rien.
    //
    // `orig` est TOUJOURS la réservation racine (.not('source','eq',
    // 'site_prolongation') plus haut — volontaire, pour hériter des vraies
    // données logistiques). Mais si le client a déjà prolongé au moins une
    // fois, orig.date_fin reste figée à la fin du contrat D'ORIGINE, pas à la
    // fin réelle du contrat en cours. Sans ce correctif, une 2e prolongation
    // repart de cette date figée : elle chevauche la 1re prolongation déjà
    // confirmée (même période comptée deux fois) et le nombre de jours
    // facturés explose (calculé jusqu'à une date de fin bien trop ancienne).
    const finReelleContrat = orig?.id ? await getEffectiveDateFin(supabase, orig.id, orig.date_fin) : (orig?.date_fin || null);
    if (finReelleContrat) {
      extDateDebut = finReelleContrat.slice(0, 10);
      if (extDateFin <= extDateDebut) {
        return res.status(400).json({ error: 'Dates de prolongation invalides' });
      }
      if (extDateDebut < today) {
        return res.status(422).json({ error: 'La date de fin initiale est déjà passée — impossible de prolonger.' });
      }
      const joursReel = Math.round((new Date(extDateFin+'T00:00:00Z') - new Date(extDateDebut+'T00:00:00Z')) / 86400000);
      if (joursReel < 1) return res.status(400).json({ error: 'Durée de prolongation invalide' });
      jours = joursReel;
    }
    // Recalcul du montant avec les dates réelles pour empêcher la manipulation de origDays.
    // dbOrigDays = durée TOTALE déjà payée à ce jour (origine + prolongations
    // déjà confirmées), pas seulement la durée du contrat d'origine — sinon le
    // palier tarifaire appliqué à la nouvelle tranche est calculé sur une base
    // trop basse (voir plus haut).
    if (orig?.date_debut && extDateDebut) {
      const dbOrigDays = Math.round((new Date(extDateDebut+'T00:00:00Z') - new Date(orig.date_debut+'T00:00:00Z')) / 86400000);
      if (dbOrigDays > 0) {
        amountCents = _safeIncrement(dbOrigDays, jours) * qty * 100;
      }
    }
    if (!amountCents || amountCents <= 0) {
      await recordFailedAttempt(supabaseRL, `checkout-prolong:${ip}`).catch(() => {});
      return res.status(400).json({ error: 'Montant invalide' });
    }
    // Commission partenaire : reprend le taux de la réservation d'origine.
    if (orig?.partenaire_id) {
      const { data: pt } = await supabase.from('partenaires')
        .select('taux_commission_pct').eq('id', orig.partenaire_id).maybeSingle();
      if (pt) partenaireCommissionCents = Math.round(amountCents * pt.taux_commission_pct / 100);
    }
  } catch (err) {
    console.error('[Checkout-prolong dates]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }

  try {
    let customerId = '';
    if (data.email) {
      const email = data.email.trim();
      const existing = await stripe.customers.list({ email, limit: 1 });
      if (existing.data.length > 0) {
        customerId = existing.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email,
          name:  [data.prenom, data.nom].filter(Boolean).join(' ') || undefined,
          phone: data.tel || undefined,
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
        `Loc'Air Prolongation — ${jours} jour${jours > 1 ? 's' : ''}`,
        clientOrigDays > 0 ? `(total ${clientOrigDays + jours}j)` : '',
        data.prenom ? `${data.prenom} ${data.nom || ''}`.trim() : '',
        data.date_recuperation ? `Récup. ${data.date_recuperation}` : '',
      ].filter(Boolean).join(' · ').slice(0, 1000),
      metadata: {
        type:              'prolongation',
        prenom:            (data.prenom            || '').slice(0, 500),
        nom:               (data.nom               || '').slice(0, 500),
        tel:               (data.tel               || '').slice(0, 500),
        adresse_origine:   (data.adresse_origine   || '').slice(0, 500),
        ref:               (data.ref               || '').slice(0, 500),
        jours:             String(jours),
        quantite:          String(qty),
        original_days:     String(clientOrigDays),
        total_days:        String(clientOrigDays + jours),
        date_debut:        (data.date_debut        || '').slice(0, 500),
        date_fin_initiale: (data.date_fin_initiale || '').slice(0, 500),
        // Calculé côté serveur à partir de extDateFin (date_fin) + 1 jour — ne pas
        // faire confiance au label formaté envoyé par le client.
        date_recuperation: (()=>{const r=addDays(extDateFin,1);const[ry,rm,rd]=r.split('-');return rd+'/'+rm+'/'+ry;})(),
        creneau:           (data.creneau           || '').slice(0, 500),
        customer_id:       customerId,
        lang:              ['fr','en','zh','ru'].includes(data.lang) ? data.lang : 'fr',
      },
    }, { idempotencyKey: `checkout-prolong-${orig?.id}-${extDateFin}` });

    const { data: insertedResa, error: insertErr } = await supabase.from('reservations').insert({
      city_id:                  city.id,
      ref:                      `PROLONG-${intent.id.slice(-8)}`,
      stripe_payment_intent_id: intent.id,
      stripe_customer_id:       customerId || null,
      prenom:                   (data.prenom          || '').slice(0, 200),
      nom:                      (data.nom             || '').slice(0, 200),
      // En minuscules, comme checkout.js — sans ça le rattachement à la
      // réservation d'origine (confirmReservation, recherche par email) peut
      // rater si la casse tapée diffère d'une fois sur l'autre.
      email:                    (data.email           || '').trim().toLowerCase().slice(0, 200),
      tel:                      (data.tel             || '').slice(0, 50),
      tel_secondaire:           orig?.tel_secondaire || null,
      hors_zone:                orig?.hors_zone || false,
      adresse:                  (data.adresse_origine || '').slice(0, 500),
      // Champs d'accès copiés depuis la réservation d'origine — nécessaires
      // pour que le transporteur puisse accéder au logement lors de la récupération.
      etage:                    orig?.etage               || null,
      ascenseur:                orig?.ascenseur            || null,
      fenetre:                  orig?.fenetre              || null,
      fenetre_photo_path:       orig?.fenetre_photo_path   || null,
      installation:             orig?.installation         || null,
      instructions_acces:       orig?.instructions_acces   || null,
      logement:                 orig?.logement             || null,
      creneau:                  (data.creneau || orig?.creneau || '').slice(0, 500),
      date_debut:               extDateDebut,
      date_fin:                 extDateFin,
      quantite:                 qty,
      prix_total_cents:         amountCents,
      statut:                   'en_attente',
      source:                   'site_prolongation',
      // Lien fiable vers la réservation prolongée — voir isSupersededReservation
      // (_lib/emailSchedule.js) et migration_reservation_origine.sql.
      reservation_origine_id:   orig?.id || null,
      // Commission partenaire : héritée du taux de la réservation d'origine.
      partenaire_id:            orig?.partenaire_id || null,
      partenaire_commission_cents: partenaireCommissionCents,
      lang:                     ['fr','en','zh','ru'].includes(data.lang) ? data.lang : 'fr',
    }).select('id').single();

    if (insertErr) {
      console.error('[Reservation prolong insert]', insertErr.message);
      await stripe.paymentIntents.cancel(intent.id).catch(e => console.error('[Stripe cancel]', e.message));
      return res.status(500).json({ error: 'Erreur serveur réservation' });
    }

    try {
      await supabase.from('cgv_acceptations').insert({
        reservation_id: insertedResa.id,
        type:           ACCEPTANCE_TYPES.CGV_LOCATION,
        version:        CGV_VERSION,
        accepted_at:    data.cgv_accepted_at || new Date().toISOString(),
      });
    } catch (e) {
      console.error('[CGV acceptations prolong]', e.message);
    }

    return res.status(200).json({ clientSecret: intent.client_secret, amountCents });
  } catch (err) {
    console.error('[Stripe prolong]', err.message);
    await recordFailedAttempt(supabaseRL, `checkout-prolong:${ip}`).catch(() => {});
    return res.status(500).json({ error: 'Erreur serveur paiement' });
  }
};
