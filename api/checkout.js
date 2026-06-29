const Stripe = require('stripe');

// Grille tarifaire identique au calcul client — prix calculé côté serveur, prix_cents ignoré
function calcBase(days) {
  days = Math.max(1, days);
  if (days <= 7)  return days * 29;
  if (days <= 14) return 7 * 29 + (days - 7) * 27;
  if (days <= 21) return 7 * 29 + 7 * 27 + (days - 14) * 22;
  return 7 * 29 + 7 * 27 + 7 * 22 + (days - 21) * 19;
}

const PROMO_CODES = { LOCAIR10: 10, LOCA10: 10 };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const data   = req.body || {};
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const duree = Math.max(7, parseInt(data.duree) || 7);
  const baseCents = calcBase(duree) * 100;

  // Valider le code promo côté serveur
  const promoCode     = (data.parrain_code || '').trim().toUpperCase();
  const promoDiscount = (PROMO_CODES[promoCode] || 0) * 100;
  const amountCents   = Math.max(0, baseCents - promoDiscount);

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
        `Loc'Air — ${duree} jour${duree > 1 ? 's' : ''}`,
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
        date:         (data.date              || '').slice(0, 500),
        creneau:      (data.creneau_livraison || '').slice(0, 500),
        installation: (data.installation      || '').slice(0, 500),
        fenetre:      (data.fenetre           || '').slice(0, 500),
        etage:        (data.etage             || '').slice(0, 500),
        ascenseur:    (data.ascenseur         || '').slice(0, 500),
        promo:        promoCode,
      },
    });

    return res.status(200).json({ clientSecret: intent.client_secret, amountCents });
  } catch (err) {
    console.error('[Stripe intent]', err.message);
    return res.status(500).json({ error: 'Erreur serveur paiement' });
  }
};
