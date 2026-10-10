const Stripe = require('stripe');
const { getSupabase } = require('./_lib/supabase');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

// PortaSplit sans engagement — tarif court terme
// 29 €/jour × durée + 30 € livraison + 80 € installation (optionnel)
// Minimum 7 jours
const RATE_PER_DAY    = 2900;  // 29 €/j
const LIVRAISON_CENTS = 3000;  // 30 € livraison A/R
const INSTALL_CENTS   = 8000;  // 80 € installation technicien
const MIN_JOURS       = 7;

const BASE_URL = 'https://www.locair.fr';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Configuration serveur manquante — contactez-nous.' });
  }

  const ip = getClientIp(req);
  try {
    if (await isRateLimited(getSupabase(), `portasplit-libre:${ip}`)) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
    }
  } catch { /* non bloquant */ }

  const data = req.body || {};

  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
    return res.status(400).json({ error: 'Adresse email requise et valide.' });
  }
  if (!data.prenom || !String(data.prenom).trim()) {
    return res.status(400).json({ error: 'Prénom requis.' });
  }
  if (!data.nom || !String(data.nom).trim()) {
    return res.status(400).json({ error: 'Nom requis.' });
  }
  if (!data.tel || String(data.tel).replace(/\D/g, '').length < 9) {
    return res.status(400).json({ error: 'Numéro de téléphone requis.' });
  }
  if (!data.adresse || !String(data.adresse).trim()) {
    return res.status(400).json({ error: 'Adresse de livraison requise.' });
  }

  const jours = parseInt(data.duree) || 0;
  if (jours < MIN_JOURS) {
    return res.status(400).json({ error: `Durée minimum : ${MIN_JOURS} jours.` });
  }

  if (data.cgv_accepted !== true || data.conditions_utilisation_accepted !== true) {
    return res.status(400).json({ error: 'Vous devez accepter les CGV et les conditions d\'utilisation.' });
  }

  const withInstall = data.installation === 'Technicien';
  const amountCents = RATE_PER_DAY * jours + LIVRAISON_CENTS + (withInstall ? INSTALL_CENTS : 0);

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const intent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: 'eur',
      metadata: {
        type:         'portasplit_libre',
        prenom:       (data.prenom  || '').slice(0, 200),
        nom:          (data.nom     || '').slice(0, 200),
        tel:          (data.tel     || '').slice(0, 50),
        email:        (data.email   || '').trim().slice(0, 200),
        adresse:      (data.adresse || '').slice(0, 500),
        duree_jours:  String(jours),
        installation: withInstall ? 'Technicien' : 'Autonome',
        date:         (data.date    || '').slice(0, 20),
      },
      receipt_email:   data.email.trim().toLowerCase(),
      description:     `PortaSplit sans engagement — ${jours} j — ${withInstall ? 'avec installation' : 'auto-install'}`,
      statement_descriptor_suffix: 'LOCAIR',
    });

    return res.status(200).json({ clientSecret: intent.client_secret, amountCents });

  } catch (err) {
    console.error('[checkout-portasplit-libre] Stripe error:', err.type, err.code, err.message);
    await recordFailedAttempt(getSupabase(), `portasplit-libre:${ip}`).catch(() => {});
    const detail = [err.type, err.code].filter(Boolean).join(' / ');
    return res.status(500).json({
      error: 'Erreur serveur paiement.',
      detail: [detail, err.message].filter(Boolean).join(' — '),
    });
  }
};
