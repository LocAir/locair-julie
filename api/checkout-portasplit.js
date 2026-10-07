const Stripe = require('stripe');
const { getSupabase } = require('./_lib/supabase');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

// Forfait PortaSplit Hiver — 12 mois
// 1er versement : 199 € = 100 € apport + 99 € (1er mois)
// Mensualités suivantes : 99 € × 11 mois
// Total engagement : 1 288 € (100 + 99 × 12)
const APPORT_CENTS  = 10_000; // 100 € — facturé une seule fois sur la 1ère invoice
const MENSUEL_CENTS =  9_900; // 99 €/mois — récurrent

const BASE_URL = 'https://www.locair.fr';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Configuration serveur manquante — contactez-nous.' });
  }

  const ip = getClientIp(req);
  try {
    if (await isRateLimited(getSupabase(), `portasplit:${ip}`)) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
    }
  } catch { /* non bloquant */ }

  const data = req.body || {};

  // Validation basique — l'email est optionnel ici car Stripe Checkout le collecte
  // sur sa page hébergée ; s'il est fourni en avance, on pré-remplit.
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
    return res.status(400).json({ error: 'Email invalide.' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    // Trouver ou créer un Customer Stripe pour lier l'abonnement
    let customerId;
    if (data.email) {
      const email = data.email.trim().toLowerCase();
      const existing = await stripe.customers.list({ email, limit: 1 });
      if (existing.data.length > 0) {
        customerId = existing.data[0].id;
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

    // Date de fin de l'abonnement : exactement 12 mois à partir d'aujourd'hui.
    // Stripe annulera automatiquement l'abonnement après la 12e mensualité.
    const cancelAt = new Date();
    cancelAt.setMonth(cancelAt.getMonth() + 12);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',

      // Pré-remplir le client si on l'a déjà ; sinon Stripe collecte l'email
      ...(customerId
        ? { customer: customerId }
        : (data.email ? { customer_email: data.email.trim().toLowerCase() } : {})),

      line_items: [{
        price_data: {
          currency: 'eur',
          unit_amount: MENSUEL_CENTS,
          recurring: { interval: 'month' },
          product_data: {
            name: 'PortaSplit Hiver · 12 mois',
            description: 'Climatisation réversible A++ · silencieux · zéro perçage',
          },
        },
        quantity: 1,
      }],

      subscription_data: {
        // L'apport de 100 € est ajouté à la 1ère facture uniquement,
        // via add_invoice_items. Résultat : 1ère facture = 199 €, suite = 99 €/mois.
        add_invoice_items: [{
          price_data: {
            currency: 'eur',
            unit_amount: APPORT_CENTS,
            product_data: { name: 'Apport initial PortaSplit (1 fois)' },
          },
        }],
        // L'abonnement s'arrête automatiquement après 12 mois
        cancel_at: Math.floor(cancelAt.getTime() / 1000),
        metadata: {
          type:    'portasplit_hiver_12mois',
          prenom:  (data.prenom  || '').slice(0, 200),
          nom:     (data.nom     || '').slice(0, 200),
          tel:     (data.tel     || '').slice(0, 50),
          adresse: (data.adresse || '').slice(0, 500),
        },
      },

      locale: 'fr',
      success_url: `${BASE_URL}/portasplit-hiver?souscrit=1`,
      cancel_url:  `${BASE_URL}/portasplit-hiver`,

      metadata: {
        type:    'portasplit_hiver_12mois',
        prenom:  (data.prenom  || '').slice(0, 200),
        adresse: (data.adresse || '').slice(0, 500),
      },
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('[checkout-portasplit] Stripe error:', err.type, err.code, err.message);
    await recordFailedAttempt(getSupabase(), `portasplit:${ip}`).catch(() => {});
    // En dev, retourner le détail Stripe pour faciliter le debug
    const detail = process.env.NODE_ENV !== 'production' ? ` (${err.code || err.type}: ${err.message})` : '';
    return res.status(500).json({ error: `Erreur serveur paiement.${detail}` });
  }
};
