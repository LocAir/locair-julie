const Stripe = require('stripe');

function calcProlongPrice(days) {
  days = Math.max(1, days);
  if (days <= 7)  return days * 29;
  if (days <= 14) return 7 * 29 + (days - 7) * 27;
  if (days <= 21) return 7 * 29 + 7 * 27 + (days - 14) * 22;
  return 7 * 29 + 7 * 27 + 7 * 22 + (days - 21) * 19;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const data   = req.body || {};
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const jours = Math.max(1, parseInt(data.jours) || 1);
  const amountCents = calcProlongPrice(jours) * 100;

  if (!amountCents || amountCents < 1900) {
    return res.status(400).json({ error: 'Montant invalide (min 1 jour)' });
  }

  try {
    const intent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      receipt_email: data.email || undefined,
      description: [
        `Loc'Air Prolongation — ${jours} jour${jours > 1 ? 's' : ''}`,
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
        date_recuperation: (data.date_recuperation || '').slice(0, 500),
        creneau:           (data.creneau           || '').slice(0, 500),
      },
    });

    return res.status(200).json({ clientSecret: intent.client_secret, amountCents });
  } catch (err) {
    console.error('[Stripe prolong]', err.message);
    return res.status(500).json({ error: 'Erreur serveur paiement' });
  }
};
