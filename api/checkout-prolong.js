const Stripe = require('stripe');

function calcBase(days) {
  days = Math.max(1, days);
  if (days <= 7)  return days * 24;
  if (days <= 14) return 7 * 24 + (days - 7) * 22;
  if (days <= 21) return 7 * 24 + 7 * 22 + (days - 14) * 20;
  return 7 * 24 + 7 * 22 + 7 * 20 + (days - 21) * 19;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const data   = req.body || {};
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const jours    = Math.max(1, parseInt(data.jours) || 1);
  const origDays = Math.max(0, parseInt(data.original_days) || 0);

  // Incremental pricing: charge only the difference between (origDays+jours) and origDays
  // so that tier transitions are priced correctly (e.g. 7→16 days = calcBase(16)−calcBase(7))
  const totalBase  = origDays > 0
    ? calcBase(origDays + jours) - calcBase(origDays)
    : calcBase(jours);
  const amountCents = totalBase * 100;

  if (!amountCents || amountCents < 1900) {
    return res.status(400).json({ error: 'Montant invalide (min 1 jour)' });
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
        origDays > 0 ? `(total ${origDays + jours}j)` : '',
        data.prenom ? `${data.prenom} ${data.nom || ''}`.trim() : '',
        data.date_recuperation ? `Récup. ${data.date_recuperation}` : '',
      ].filter(Boolean).join(' · ').slice(0, 1000),
      metadata: {
        type:              'prolongation',
        prenom:            (data.prenom            || '').slice(0, 500),
        nom:               (data.nom               || '').slice(0, 500),
        tel:               (data.tel               || '').slice(0, 500),
        adresse_origine:   (data.adresse_origine   || '').slice(0, 500),
        jours:             String(jours),
        original_days:     String(origDays),
        total_days:        String(origDays + jours),
        date_debut:        (data.date_debut        || '').slice(0, 500),
        date_fin_initiale: (data.date_fin_initiale || '').slice(0, 500),
        date_recuperation: (data.date_recuperation || '').slice(0, 500),
        creneau:           (data.creneau           || '').slice(0, 500),
        customer_id:       customerId,
      },
    });

    return res.status(200).json({ clientSecret: intent.client_secret, amountCents });
  } catch (err) {
    console.error('[Stripe prolong]', err.message);
    return res.status(500).json({ error: 'Erreur serveur paiement' });
  }
};
