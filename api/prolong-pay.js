const Stripe = require('stripe');
const { getSupabase }     = require('./_lib/supabase');
const { isValidDate, addDays, todayParis } = require('./_lib/dates');
const { calcTieredPrice, getPricingConfig } = require('./_lib/pricing');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');
const { CGV_VERSION, ACCEPTANCE_TYPES } = require('./_lib/legal');
const { getEffectiveDateFin } = require('./_lib/reservations');
const { verifyClientToken } = require('./_lib/auth');

function diffDays(startStr, endStr) {
  return Math.round(
    (new Date(endStr + 'T00:00:00Z') - new Date(startStr + 'T00:00:00Z')) / 86400000
  );
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseRL = getSupabase();
  const ip = getClientIp(req);
  try {
    if (await isRateLimited(supabaseRL, `prolong-pay:${ip}`)) {
      return res.status(429).json({ error: 'Trop de tentatives, réessayez dans 15 minutes.' });
    }
  } catch (e) {
    // Supabase momentanément indisponible — on laisse passer (même comportement que checkout.js).
    console.error('[ratelimit] prolong-pay:', e.message);
  }

  const { email, ref, new_date_fin, cgv_accepted, client_token } = req.body || {};

  if (!email || !new_date_fin) {
    return res.status(400).json({ error: 'Email et nouvelle date de fin requis' });
  }
  if (!isValidDate(new_date_fin)) {
    return res.status(400).json({ error: 'Date invalide' });
  }
  // Même contrôle serveur que /api/checkout et /api/checkout-prolong — cette
  // page (prolongation.html, atteinte par le lien envoyé au client) n'avait
  // jusqu'ici aucune case CGV ni trace d'acceptation, contrairement à toutes
  // les autres pages de paiement du site.
  if (cgv_accepted !== true) {
    return res.status(400).json({ error: 'Vous devez accepter les CGV avant de payer.' });
  }

  const supabase = getSupabase();
  const stripe   = new Stripe(process.env.STRIPE_SECRET_KEY);
  // Tarifs (panneau de contrôle admin, voir admin-pricing.js) chargés une
  // seule fois pour toute la requête, jamais recalculés en dur.
  const pricing  = await getPricingConfig(supabase);
  const calcBase = (days) => calcTieredPrice(days, pricing);

  // Retrouver la réservation d'origine par email (+ ref si fournie).
  // .eq('statut','confirmee') indispensable : sans lui, une réservation plus
  // récente mais annulée/en attente sous le même email (tentative abandonnée,
  // doublon) passe devant la vraie réservation active dans le tri par date de
  // création — la prolongation se rattache alors à la mauvaise réservation.
  // Même filtre déjà en place côté admin (admin-reservations.js, action
  // 'lookup_prolongation').
  const normalizedEmail = String(email).trim().toLowerCase();

  // Si un token de session est fourni (espace client connecté), vérifier que
  // la session appartient bien à cet email — empêche un client connecté de
  // prolonger la réservation d'un autre en changeant le champ email.
  // Sans token (lien SMS /prolongation.html), le contrôle est contourné
  // intentionnellement : le lien est à usage unique et rate-limité.
  //
  // CORRECTIF (2026-08-07) : l'ancienne implémentation cherchait le token dans
  // une table `client_sessions` qui n'existe plus (remplacée par le système
  // HMAC signClientToken/verifyClientToken de _lib/auth.js). Le lookup DB
  // retournait toujours sess=null → "Session invalide." pour tout paiement
  // depuis l'espace client. Remplacé par verifyClientToken.
  if (client_token) {
    const fakeReq = { body: { token: client_token }, headers: {} };
    const verifiedResaId = await verifyClientToken(fakeReq, supabase);
    if (!verifiedResaId) {
      return res.status(401).json({ error: 'Session invalide.' });
    }
    // Vérifier que la réservation du token correspond bien à cet email
    const { data: sesResa } = await supabase
      .from('reservations').select('email').eq('id', verifiedResaId).maybeSingle();
    if (!sesResa || sesResa.email.toLowerCase() !== normalizedEmail) {
      return res.status(401).json({ error: 'Session invalide.' });
    }
  }

  let q = supabase
    .from('reservations')
    .select('id, ref, prenom, nom, tel, adresse, city_id, date_debut, date_fin, quantite, statut, stripe_customer_id, tel_secondaire, hors_zone, email, partenaire_id, lang, etage, ascenseur, fenetre, fenetre_photo_path, installation, instructions_acces, logement')
    .ilike('email', normalizedEmail)
    .not('source', 'eq', 'site_prolongation')
    .eq('statut', 'confirmee')
    .order('created_at', { ascending: false })
    .limit(1);

  if (ref && ref.trim()) {
    q = supabase
      .from('reservations')
      .select('id, ref, prenom, nom, tel, adresse, city_id, date_debut, date_fin, quantite, statut, stripe_customer_id, tel_secondaire, hors_zone, email, partenaire_id, lang, etage, ascenseur, fenetre, fenetre_photo_path, installation, instructions_acces, logement')
      .ilike('email', normalizedEmail)
      .eq('ref', ref.trim().toUpperCase())
      .not('source', 'eq', 'site_prolongation')
      .eq('statut', 'confirmee')
      .order('created_at', { ascending: false })
      .limit(1);
  }

  const { data: orig, error: lookupErr } = await q.maybeSingle();

  if (lookupErr) {
    console.error('[prolong-pay lookup]', lookupErr.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
  if (!orig) {
    return res.status(404).json({ error: 'Réservation introuvable.' });
  }
  // Si le client a déjà prolongé au moins une fois et que le webhook a
  // silencieusement raté la MAJ de orig.date_fin, on risque de recalculer le
  // prix sur une base obsolète (surfacturation) et de poser date_debut à la
  // mauvaise date (mission récup fantôme). Même filet que checkout-prolong.js
  // (voir getEffectiveDateFin, _lib/reservations.js).
  if (orig.id) {
    orig.date_fin = await getEffectiveDateFin(supabase, orig.id, orig.date_fin);
  }

  const today = todayParis();
  if (orig.date_fin < today) {
    return res.status(422).json({ error: 'La location est déjà terminée — impossible de prolonger.' });
  }
  if (new_date_fin <= orig.date_fin) {
    return res.status(400).json({ error: `La nouvelle date doit être postérieure au ${orig.date_fin}.` });
  }

  // Langue : priorité à la préférence explicite de la session en cours (espace
  // client multilingue), sinon héritage de la langue de la réservation d'origine
  // — sans ça, toutes les communications de prolongation depuis /prolongation.html
  // et l'espace client partaient toujours en français, même pour les clients
  // anglais/chinois/russes (req.body.lang absent de prolongation.html, et `lang`
  // absent du SELECT et de l'INSERT).
  const lang = ['fr','en','zh','ru'].includes(req.body?.lang) ? req.body.lang : (orig.lang || 'fr');

  const origDays  = diffDays(orig.date_debut, orig.date_fin);
  const totalDays = diffDays(orig.date_debut, new_date_fin);
  const jours     = totalDays - origDays;

  if (jours < 1) {
    return res.status(400).json({ error: 'Durée minimale : 1 jour.' });
  }

  // Même logique que checkout-prolong.js (_safeIncrement) : filet de sécurité
  // pour un incrément négatif, qui ne devrait plus survenir pour une nouvelle
  // réservation (7 jours minimum) mais reste possible pour une prolongation
  // d'une réservation antérieure à la suppression du palier 3-6 jours.
  const rawDelta  = calcBase(totalDays) - calcBase(origDays);
  const safeDelta = rawDelta > 0 ? rawDelta : Math.round(calcBase(totalDays) / totalDays) * jours;
  const baseCents    = safeDelta * (orig.quantite || 1) * 100;
  // Pas de code promo sur une prolongation — réservé aux nouvelles commandes
  // passées sur le site (voir checkout.js, _lib/promo.js).
  const amountCents  = baseCents;

  // Commission partenaire : reprend le taux de la réservation d'origine.
  let partenaireCommissionCents = 0;
  if (orig.partenaire_id) {
    const { data: pt } = await supabase.from('partenaires')
      .select('taux_commission_pct').eq('id', orig.partenaire_id).maybeSingle();
    if (pt) partenaireCommissionCents = Math.round(amountCents * pt.taux_commission_pct / 100);
  }

  if (!amountCents || amountCents < 100) {
    return res.status(400).json({ error: 'Montant invalide' });
  }

  const dateFinDisplay = new Date(new_date_fin + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  let intentId = null;
  try {
    let customerId = orig.stripe_customer_id || '';
    if (!customerId) {
      const existing = await stripe.customers.list({ email: String(email).trim(), limit: 1 });
      customerId = existing.data.length > 0 ? existing.data[0].id : '';
    }

    const intent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      setup_future_usage: 'off_session',
      customer:      customerId || undefined,
      receipt_email: String(email).trim(),
      description:   `Loc'Air Prolongation — +${jours}j jusqu'au ${dateFinDisplay} · ${orig.ref || ''}`,
      metadata: {
        type:              'prolongation',
        prenom:            (orig.prenom  || '').slice(0, 500),
        nom:               (orig.nom     || '').slice(0, 500),
        tel:               (orig.tel     || '').slice(0, 500),
        adresse_origine:   (orig.adresse || '').slice(0, 500),
        ref_origine:       (orig.ref     || '').slice(0, 500),
        jours:             String(jours),
        original_days:     String(origDays),
        total_days:        String(totalDays),
        date_debut:        orig.date_debut,
        date_fin_initiale: orig.date_fin,
        date_recuperation: (()=>{const r=addDays(new_date_fin,1);const[ry,rm,rd]=r.split('-');return rd+'/'+rm+'/'+ry;})(),
        customer_id:       customerId,
        lang:              lang,
      },
    }, { idempotencyKey: `prolong-pay-${orig.id}-${new_date_fin}` });
    intentId = intent.id;

    const { data: insertedResa, error: insertErr } = await supabase.from('reservations').insert({
      city_id:                  orig.city_id,
      ref:                      `PROLONG-${intent.id.slice(-8)}`,
      stripe_payment_intent_id: intent.id,
      stripe_customer_id:       customerId || null,
      prenom:                   (orig.prenom  || '').slice(0, 200),
      nom:                      (orig.nom     || '').slice(0, 200),
      // Reprend l'email tel que stocké sur la réservation d'origine (pas
      // celui retapé par le client) : confirmReservation() retrouve ensuite
      // cette réservation d'origine par une comparaison stricte sur ce champ
      // (pour annuler sa récupération devenue obsolète) — une casse
      // différente d'une saisie à l'autre lui aurait fait rater le
      // rattachement, laissant une mission de récupération fantôme au
      // calendrier.
      email:                    orig.email,
      tel:                      (orig.tel     || '').slice(0, 50),
      tel_secondaire:           orig.tel_secondaire || null,
      adresse:                  (orig.adresse || '').slice(0, 500),
      // Reprend le statut hors zone de la réservation d'origine — sans ça la
      // nouvelle réservation repartait toujours à "false" par défaut, et le
      // transporteur touchait le tarif normal (au lieu du tarif hors zone)
      // pour la récupération de cette prolongation.
      hors_zone:                orig.hors_zone || false,
      // Champs d'accès copiés depuis la réservation d'origine — nécessaires
      // pour que le transporteur puisse accéder au logement lors de la récupération.
      etage:                    orig.etage               || null,
      ascenseur:                orig.ascenseur            || null,
      fenetre:                  orig.fenetre              || null,
      fenetre_photo_path:       orig.fenetre_photo_path   || null,
      installation:             orig.installation         || null,
      instructions_acces:       orig.instructions_acces   || null,
      logement:                 orig.logement             || null,
      date_debut:               orig.date_fin,
      date_fin:                 new_date_fin,
      quantite:                 orig.quantite || 1,
      prix_total_cents:         amountCents,
      statut:                   'en_attente',
      source:                   'site_prolongation',
      // Lien fiable vers la réservation prolongée — voir isSupersededReservation
      // (_lib/emailSchedule.js) et migration_reservation_origine.sql.
      reservation_origine_id:   orig.id,
      // Langue héritée de l'origine (ou de la session en cours si fournie) —
      // nécessaire pour que sendProlongationConfirmation (webhook.js) et les
      // futurs SMS automatisés (cron) utilisent la bonne langue.
      lang:                     lang,
      // Commission partenaire : héritée du taux de la réservation d'origine.
      partenaire_id:            orig.partenaire_id || null,
      partenaire_commission_cents: partenaireCommissionCents,
    }).select('id').single();

    if (insertErr) {
      console.error('[prolong-pay insert]', insertErr.message);
      await stripe.paymentIntents.cancel(intent.id).catch(e => console.error('[Stripe cancel]', e.message));
      return res.status(500).json({ error: 'Erreur serveur réservation' });
    }

    try {
      await supabase.from('cgv_acceptations').insert({
        reservation_id: insertedResa.id,
        type:           ACCEPTANCE_TYPES.CGV_LOCATION,
        version:        CGV_VERSION,
        accepted_at:    new Date().toISOString(),
      });
    } catch (e) {
      console.error('[CGV acceptations prolong-pay]', e.message);
    }

    return res.status(200).json({
      clientSecret: intent.client_secret,
      amountCents,
      jours,
      newDateFin: new_date_fin,
    });
  } catch (err) {
    console.error('[prolong-pay stripe]', err.message);
    if (intentId) await stripe.paymentIntents.cancel(intentId).catch(() => {});
    await recordFailedAttempt(supabaseRL, `prolong-pay:${ip}`).catch(() => {});
    return res.status(500).json({ error: 'Erreur serveur paiement' });
  }
};
