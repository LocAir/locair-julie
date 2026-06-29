const Stripe = require('stripe');

// Crée un PaymentIntent dynamique — montant calculé côté client, validé ici
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const data   = req.body || {};
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const amountCents = parseInt(data.prix_cents || '0');
  if (!amountCents || amountCents < 2000) {
    return res.status(400).json({ error: 'Montant invalide (min 20 €)' });
  }

  try {
    const intent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      receipt_email: data.email || undefined,
      description: [
        `Loc'Air — ${data.duree || '?'} jour${parseInt(data.duree) > 1 ? 's' : ''}`,
        data.date        ? `Livraison ${data.date}`   : '',
        data.creneau_livraison                        || '',
        data.adresse                                  || '',
      ].filter(Boolean).join(' · ').slice(0, 1000),
      metadata: {
        ref:          (data._ref              || '').slice(0, 500),
        prenom:       (data.prenom            || '').slice(0, 500),
        nom:          (data.nom               || '').slice(0, 500),
        tel:          (data.tel               || '').slice(0, 500),
        adresse:      (data.adresse           || '').slice(0, 500),
        duree:        String(parseInt(data.duree || '7')),
        date:         (data.date              || '').slice(0, 500),
        creneau:      (data.creneau_livraison || '').slice(0, 500),
        installation: (data.installation      || '').slice(0, 500),
        fenetre:      (data.fenetre           || '').slice(0, 500),
        etage:        (data.etage             || '').slice(0, 500),
        ascenseur:    (data.ascenseur         || '').slice(0, 500),
      },
    });

    return res.status(200).json({ clientSecret: intent.client_secret });
  } catch (err) {
    console.error('[Stripe intent]', err.message);
    return res.status(500).json({ error: 'Erreur serveur paiement' });
  }
};
