const Stripe = require('stripe');
const { getSupabase } = require('./_lib/supabase');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

// Forfait PortaSplit — 6 mois minimum
// 1er versement : 199 € = 100 € apport + 99 € (1er mois)
// Mensualités suivantes : 99 € × 5 mois
// Total engagement : 694 € (100 + 99 × 6)
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

  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
    return res.status(400).json({ error: 'Email invalide.' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    // L'apport 100 € est mis en line_item sans recurring — Stripe l'affiche
    // clairement sur la page de paiement et l'inclut dans la 1ère facture.
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',

      ...(data.email ? { customer_email: data.email.trim().toLowerCase() } : {}),

      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: APPORT_CENTS,
            product_data: {
              name: 'Apport initial PortaSplit',
              description: 'Frais unique — inclus dans le 1er prélèvement',
            },
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'eur',
            unit_amount: MENSUEL_CENTS,
            recurring: { interval: 'month' },
            product_data: {
              name: 'PortaSplit · 6 mois',
              description: 'Climatisation réversible A++ · silencieux · zéro perçage',
            },
          },
          quantity: 1,
        },
      ],

      subscription_data: {
        metadata: {
          type:    'portasplit_6mois',
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
        type:    'portasplit_6mois',
        prenom:  (data.prenom  || '').slice(0, 200),
        adresse: (data.adresse || '').slice(0, 500),
      },
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('[checkout-portasplit] Stripe error:', err.type, err.code, err.message);
    await recordFailedAttempt(getSupabase(), `portasplit:${ip}`).catch(() => {});
    const detail = [err.type, err.code].filter(Boolean).join(' / ');
    return res.status(500).json({
      error: 'Erreur serveur paiement.',
      detail: [detail, err.message].filter(Boolean).join(' — '),
    });
  }
};
