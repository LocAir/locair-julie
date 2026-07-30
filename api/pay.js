const Stripe = require('stripe');
const { getSupabase } = require('./_lib/supabase');

// Lien court envoyé par SMS à la place de l'URL Stripe Checkout brute
// (200-300+ caractères à elle seule, ce qui bascule le SMS en 3-4 segments
// facturés séparément et ralentit assez l'appel Brevo pour parfois dépasser
// son délai d'abandon — voir BREVO_TIMEOUT_MS dans _lib/brevo.js, cause du
// "SMS envoyé mais l'admin voit quand même une erreur"). Utilise le
// PaymentIntent déjà stocké sur la réservation (opaque, généré par Stripe,
// aussi difficile à deviner que l'URL Checkout elle-même) comme clé de
// redirection plutôt que la référence de commande — celle-ci est un
// identifiant à faible entropie (déjà utilisée comme accès "sans mot de
// passe" à l'espace client) qu'il ne faut pas transformer en clé d'accès à
// une page de paiement.
function redirect(res, url) {
  res.setHeader('Location', url);
  res.statusCode = 302;
  return res.end();
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');

  const pi = String(req.query?.pi || '').trim();
  if (!pi || !pi.startsWith('pi_')) return res.status(400).send('Lien invalide.');

  try {
    const supabase = getSupabase();
    const { data: resa } = await supabase
      .from('reservations').select('id, statut').eq('stripe_payment_intent_id', pi).maybeSingle();
    if (!resa) return redirect(res, 'https://www.locair.fr/?paiement=introuvable');
    if (resa.statut !== 'en_attente') return redirect(res, 'https://www.locair.fr/?paiement=confirme');

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const sessions = await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 });
    const session = sessions.data[0];
    // Session Stripe Checkout expirée (plus de 24h) : mieux vaut renvoyer
    // vers le site avec un message clair que vers une page Stripe morte —
    // le client doit alors redemander un lien (renvoyer_lien_paiement,
    // relance automatique du cron, ou rappel de l'admin).
    if (!session || session.status !== 'open') return redirect(res, 'https://www.locair.fr/?paiement=expire');

    return redirect(res, session.url);
  } catch (e) {
    console.error('[api/pay]', e.message);
    return redirect(res, 'https://www.locair.fr/?paiement=erreur');
  }
};
