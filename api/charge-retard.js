const Stripe  = require('stripe');
const crypto  = require('crypto');
const { getSupabase } = require('./_lib/supabase');

function safeEqual(a, b) {
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; }
}

function calcRetardPrice(days) {
  days = Math.max(1, days);
  if (days <= 7)  return days * 20;
  if (days <= 14) return 7 * 20 + (days - 7) * 18;
  if (days <= 21) return 7 * 20 + 7 * 18 + (days - 14) * 17;
  return 7 * 20 + 7 * 18 + 7 * 17 + (days - 21) * 16;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = ((req.body || {}).token || req.headers['x-operator-token'] || '').trim();
  if (!process.env.OPERATOR_TOKEN || !safeEqual(token, process.env.OPERATOR_TOKEN)) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const data   = req.body || {};
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const jours  = Math.max(1, parseInt(data.jours) || 1);
  const amountCents = calcRetardPrice(jours) * 100;

  try {
    let customerId      = (data.customer_id || '').trim();
    let paymentMethodId = (data.payment_method_id || '').trim();

    // Recherche par email si pas de customer_id
    if (!customerId && data.email) {
      const list = await stripe.customers.list({ email: data.email.trim(), limit: 1 });
      if (list.data.length > 0) customerId = list.data[0].id;
    }

    if (!customerId) {
      return res.status(400).json({ error: 'Client introuvable — fournissez customer_id ou email.' });
    }

    // Retrouver la carte enregistrée si non fournie
    if (!paymentMethodId) {
      const methods = await stripe.paymentMethods.list({ customer: customerId, type: 'card' });
      if (!methods.data.length) {
        return res.status(400).json({ error: 'Aucun moyen de paiement enregistré pour ce client. La carte n\'a peut-être pas été sauvegardée lors de la réservation.' });
      }
      paymentMethodId = methods.data[0].id;
    }

    // Clé d'idempotence : empêche le double-prélèvement sur double-clic ou retry
    const today = new Date().toISOString().slice(0, 10);
    const idempotencyKey = `retard-${customerId}-${jours}j-${today}`;

    const intent = await stripe.paymentIntents.create({
      amount:         amountCents,
      currency:       'eur',
      customer:       customerId,
      payment_method: paymentMethodId,
      off_session:    true,
      confirm:        true,
      receipt_email:  data.email || undefined,
      description: [
        `Loc'Air — Retard de restitution ${jours} jour${jours > 1 ? 's' : ''}`,
        (data.nom     || '').trim(),
        (data.adresse || '').trim(),
      ].filter(Boolean).join(' · ').slice(0, 1000),
      metadata: {
        type:    'retard',
        nom:     (data.nom     || '').slice(0, 500),
        jours:   String(jours),
        adresse: (data.adresse || '').slice(0, 500),
      },
    }, { idempotencyKey });

    // Journalise l'incident pour le tableau de bord — ne doit jamais faire échouer
    // la réponse puisque le prélèvement Stripe a déjà réussi.
    try {
      const supabase = getSupabase();
      let reservationId = null;
      let resa = null;
      if (customerId) {
        ({ data: resa } = await supabase
          .from('reservations').select('id, city_id')
          .eq('stripe_customer_id', customerId)
          .order('created_at', { ascending: false }).limit(1).maybeSingle());
      }
      if (!resa && data.email) {
        ({ data: resa } = await supabase
          .from('reservations').select('id, city_id')
          .eq('email', data.email.trim())
          .order('created_at', { ascending: false }).limit(1).maybeSingle());
      }
      if (resa) reservationId = resa.id;
      // Pas de ville devinée en secours : sans réservation retrouvée, mieux
      // vaut un incident sans city_id (visible sur toutes les vues) qu'une
      // supposition fausse une fois plusieurs zones actives.
      const cityId = resa?.city_id || null;

      await supabase.from('incidents').insert({
        city_id:                cityId,
        reservation_id:        reservationId,
        type:                   'retard',
        description:            `${jours} jour${jours > 1 ? 's' : ''} de retard — ${(data.nom || '').slice(0, 200)}`,
        montant_facture_cents:  amountCents,
        statut:                 'facture',
      });
    } catch (e) {
      console.error('[Incident retard]', e.message);
    }

    return res.status(200).json({
      success:           true,
      amount_eur:        (amountCents / 100).toFixed(2),
      status:            intent.status,
      payment_intent_id: intent.id,
    });

  } catch (err) {
    console.error('[Stripe retard]', err.message);

    // DSP2 : authentification 3D Secure requise — Stripe envoie un email au client automatiquement
    if (err.code === 'authentication_required' || err.payment_intent?.status === 'requires_action') {
      return res.status(402).json({
        error:             '3D Secure requis — Stripe a envoyé un email au client pour qu\'il valide le paiement.',
        requires_action:   true,
        payment_intent_id: err.payment_intent?.id || '',
      });
    }

    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
};
