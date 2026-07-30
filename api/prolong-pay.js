const Stripe = require('stripe');
const { getSupabase }     = require('./_lib/supabase');
const { isValidDate, addDays } = require('./_lib/dates');
const { calcTieredPrice: calcBase } = require('./_lib/pricing');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

function diffDays(startStr, endStr) {
  return Math.round(
    (new Date(endStr + 'T00:00:00Z') - new Date(startStr + 'T00:00:00Z')) / 86400000
  );
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseRL = getSupabase();
  const ip = getClientIp(req);
  if (await isRateLimited(supabaseRL, `prolong-pay:${ip}`)) {
    return res.status(429).json({ error: 'Trop de tentatives, réessayez dans 15 minutes.' });
  }

  const { email, ref, new_date_fin } = req.body || {};

  if (!email || !new_date_fin) {
    return res.status(400).json({ error: 'Email et nouvelle date de fin requis' });
  }
  if (!isValidDate(new_date_fin)) {
    return res.status(400).json({ error: 'Date invalide' });
  }

  const supabase = getSupabase();
  const stripe   = new Stripe(process.env.STRIPE_SECRET_KEY);

  // Retrouver la réservation d'origine par email (+ ref si fournie).
  // .eq('statut','confirmee') indispensable : sans lui, une réservation plus
  // récente mais annulée/en attente sous le même email (tentative abandonnée,
  // doublon) passe devant la vraie réservation active dans le tri par date de
  // création — la prolongation se rattache alors à la mauvaise réservation.
  // Même filtre déjà en place côté admin (admin-reservations.js, action
  // 'lookup_prolongation').
  const normalizedEmail = String(email).trim().toLowerCase();
  let q = supabase
    .from('reservations')
    .select('id, ref, prenom, nom, tel, adresse, city_id, date_debut, date_fin, quantite, statut, stripe_customer_id, tel_secondaire, hors_zone, email, partenaire_id')
    .ilike('email', normalizedEmail)
    .not('source', 'eq', 'site_prolongation')
    .eq('statut', 'confirmee')
    .order('created_at', { ascending: false })
    .limit(1);

  if (ref && ref.trim()) {
    q = supabase
      .from('reservations')
      .select('id, ref, prenom, nom, tel, adresse, city_id, date_debut, date_fin, quantite, statut, stripe_customer_id, tel_secondaire, hors_zone, email, partenaire_id')
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
  const today = new Date().toISOString().slice(0, 10);
  if (orig.date_fin < today) {
    return res.status(422).json({ error: 'La location est déjà terminée — impossible de prolonger.' });
  }
  if (new_date_fin <= orig.date_fin) {
    return res.status(400).json({ error: `La nouvelle date doit être postérieure au ${orig.date_fin}.` });
  }

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
        lang:              ['fr','en','zh','ru'].includes(req.body.lang) ? req.body.lang : 'fr',
      },
    });

    const { error: insertErr } = await supabase.from('reservations').insert({
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
      date_debut:               orig.date_fin,
      date_fin:                 new_date_fin,
      quantite:                 orig.quantite || 1,
      prix_total_cents:         amountCents,
      statut:                   'en_attente',
      source:                   'site_prolongation',
      // Lien fiable vers la réservation prolongée — voir isSupersededReservation
      // (_lib/emailSchedule.js) et migration_reservation_origine.sql.
      reservation_origine_id:   orig.id,
      // Commission partenaire : héritée du taux de la réservation d'origine.
      partenaire_id:            orig.partenaire_id || null,
      partenaire_commission_cents: partenaireCommissionCents,
    });

    if (insertErr) {
      console.error('[prolong-pay insert]', insertErr.message);
      await stripe.paymentIntents.cancel(intent.id).catch(e => console.error('[Stripe cancel]', e.message));
      return res.status(500).json({ error: 'Erreur serveur réservation' });
    }

    return res.status(200).json({
      clientSecret: intent.client_secret,
      amountCents,
      jours,
      newDateFin: new_date_fin,
    });
  } catch (err) {
    console.error('[prolong-pay stripe]', err.message);
    await recordFailedAttempt(supabaseRL, `prolong-pay:${ip}`).catch(() => {});
    return res.status(500).json({ error: 'Erreur serveur paiement' });
  }
};
