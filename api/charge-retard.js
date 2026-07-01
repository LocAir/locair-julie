const Stripe = require('stripe');

function calcRetardPrice(days) {
  days = Math.max(1, days);
  if (days <= 7)  return days * 29;
  if (days <= 14) return 7 * 29 + (days - 7) * 27;
  if (days <= 21) return 7 * 29 + 7 * 27 + (days - 14) * 22;
  return 7 * 29 + 7 * 27 + 7 * 22 + (days - 21) * 19;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = ((req.body || {}).token || req.headers['x-operator-token'] || '').trim();
  if (!process.env.OPERATOR_TOKEN || token !== process.env.OPERATOR_TOKEN) {
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
        data.nom     ? (data.nom     || '').trim() : '',
        data.adresse ? (data.adresse || '').trim() : '',
      ].filter(Boolean).join(' · ').slice(0, 1000),
      metadata: {
        type:    'retard',
        nom:     (data.nom     || '').slice(0, 500),
        jours:   String(jours),
        adresse: (data.adresse || '').slice(0, 500),
      },
    });

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
