const Stripe = require('stripe');

function calcBase(days) {
  days = Math.max(1, days);
  if (days <= 7)  return days * 24;
  if (days <= 14) return 7 * 24 + (days - 7) * 22;
  if (days <= 21) return 7 * 24 + 7 * 22 + (days - 14) * 20;
  return 7 * 24 + 7 * 22 + 7 * 20 + (days - 21) * 19;
}

const PROMO_CODES  = { LOCAIR10: 10, LOCA10: 10 };
const DELIVERY_FEE = 35;
const INSTALL_FEE  = 25;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const data   = req.body || {};
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const duree = Math.max(7, parseInt(data.duree) || 7);
  const baseCents     = calcBase(duree) * 100;
  const isTech        = (data.installation || '').startsWith('Technicien');
  const installCents  = isTech ? INSTALL_FEE * 100 : 0;
  const promoCode     = (data.parrain_code || '').trim().toUpperCase();
  const promoDiscount = (PROMO_CODES[promoCode] || 0) * 100;
  const amountCents   = Math.max(0, baseCents + installCents + DELIVERY_FEE * 100 - promoDiscount);

  if (!amountCents || amountCents < 20000) {
    return res.status(400).json({ error: 'Montant invalide (min 200 €)' });
  }

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
        customer_id:  customerId,
      },
    });

    return res.status(200).json({ clientSecret: intent.client_secret, amountCents, customerId });
  } catch (err) {
    console.error('[Stripe intent]', err.message);
    return res.status(500).json({ error: 'Erreur serveur paiement' });
  }
};
