const Stripe = require('stripe');
const { getSupabase } = require('./_lib/supabase');

// Lien court envoyé par SMS à la place de l'URL Stripe Checkout brute
// (200-300+ caractères à elle seule, ce qui bascule le SMS en 3-4 segments
// facturés séparément et ralentit assez l'appel Brevo pour parfois dépasser
// son délai d'abandon — voir BREVO_TIMEOUT_MS dans _lib/brevo.js, cause du
// "SMS envoyé mais l'admin voit quand même une erreur").
//
// Clé de redirection = l'ID de la Checkout Session elle-même (cs_…), opaque
// et généré par Stripe, aussi difficile à deviner que l'URL Checkout —
// jamais la référence de commande (identifiant à faible entropie, déjà
// utilisée comme accès "sans mot de passe" à l'espace client, qu'il ne faut
// pas transformer en clé d'accès à une page de paiement).
//
// PAS le PaymentIntent (voir ?pi= ci-dessous, gardé en repli uniquement) :
// contrairement à ce qu'indiquait ce commentaire jusqu'ici, session.payment_intent
// n'est pas fiable juste après stripe.checkout.sessions.create() — constaté
// en prod sur une session à 294 € (donc pas le cas particulier des sessions
// à 0 € déjà connu) où il valait null, faisant retomber sur l'URL Checkout
// complète malgré le correctif censé la raccourcir. session.id, lui, existe
// toujours dès la création — aucune ambiguïté de timing possible.
function redirect(res, url) {
  res.setHeader('Location', url);
  res.statusCode = 302;
  return res.end();
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');

  const cs = String(req.query?.cs || '').trim();
  const pi = String(req.query?.pi || '').trim();

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    if (cs && cs.startsWith('cs_')) {
      const session = await stripe.checkout.sessions.retrieve(cs);
      if (session.status === 'complete') return redirect(res, 'https://www.locair.fr/?paiement=confirme');
      // Session Stripe Checkout expirée (plus de 24h) : mieux vaut renvoyer
      // vers le site avec un message clair que vers une page Stripe morte —
      // le client doit alors redemander un lien (renvoyer_lien_paiement,
      // relance automatique du cron, ou rappel de l'admin).
      if (session.status !== 'open') return redirect(res, 'https://www.locair.fr/?paiement=expire');
      return redirect(res, session.url);
    }

    // Repli pour tout lien ?pi= déjà envoyé avant ce correctif, encore non
    // cliqué dans la conversation SMS d'un client — à retirer une fois ces
    // anciens liens raisonnablement périmés.
    if (pi && pi.startsWith('pi_')) {
      const supabase = getSupabase();
      const { data: resa } = await supabase
        .from('reservations').select('id, statut').eq('stripe_payment_intent_id', pi).maybeSingle();
      if (!resa) return redirect(res, 'https://www.locair.fr/?paiement=introuvable');
      if (resa.statut !== 'en_attente') return redirect(res, 'https://www.locair.fr/?paiement=confirme');
      const sessions = await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 });
      const session = sessions.data[0];
      if (!session || session.status !== 'open') return redirect(res, 'https://www.locair.fr/?paiement=expire');
      return redirect(res, session.url);
    }

    return res.status(400).send('Lien invalide.');
  } catch (e) {
    console.error('[api/pay]', e.message);
    return redirect(res, 'https://www.locair.fr/?paiement=erreur');
  }
};
