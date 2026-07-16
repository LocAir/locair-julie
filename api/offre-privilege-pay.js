const Stripe = require('stripe');
const { getSupabase } = require('./_lib/supabase');
const { verifyClientToken } = require('./_lib/auth');

// Offre Privilège (Step 2) : le client accepte de garder son climatiseur
// actuel au lieu de le rendre, et paie en ligne. Crée uniquement le
// paiement Stripe — la suite (offre "acceptee", appareil "vendu",
// annulation automatique de la récupération) se joue dans le webhook
// Stripe (payment_intent.succeeded, metadata.type === 'offre_privilege'),
// jamais ici.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();

  const reservationId = await verifyClientToken(req, supabase);
  if (!reservationId) return res.status(401).json({ error: 'Session expirée, merci de vous reconnecter.' });

  const offreId = parseInt((req.body || {}).offre_id);
  if (!offreId) return res.status(400).json({ error: 'Offre introuvable' });

  try {
    const { data: offre } = await supabase
      .from('offres_privilege').select('id, statut, prix_vente_cents, reservation_id, appareil_id')
      .eq('id', offreId).maybeSingle();
    if (!offre || offre.reservation_id !== reservationId) return res.status(404).json({ error: 'Offre introuvable' });
    if (offre.statut !== 'proposee') return res.status(400).json({ error: "Cette offre n'est plus disponible." });
    if (!offre.prix_vente_cents) return res.status(400).json({ error: 'Prix non défini' });

    // Toujours reprendre les vraies infos de la commande et de l'appareil au
    // moment du paiement (jamais des valeurs mises en cache côté client) :
    // le paiement Stripe doit pouvoir être relié, à lui seul, à la commande
    // (ref = numéro utilisé par le client pour accéder à son espace) et au
    // climatiseur précis vendu.
    const [{ data: resa }, { data: appareil }] = await Promise.all([
      supabase.from('reservations').select('email, tel, prenom, nom, ref').eq('id', reservationId).maybeSingle(),
      supabase.from('appareils').select('numero, reference').eq('id', offre.appareil_id).maybeSingle(),
    ]);

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const intent = await stripe.paymentIntents.create({
      amount:   offre.prix_vente_cents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      receipt_email: resa?.email || undefined,
      description: `Loc'Air — Offre Privilège — achat climatiseur n°${appareil?.numero ?? ''} (dossier ${resa?.ref || ''})`.slice(0, 1000),
      metadata: {
        type:              'offre_privilege',
        offre_id:          String(offre.id),
        reservation_id:    String(reservationId),
        // Numéro de dossier = ce que le client saisit sur /client pour
        // retrouver son espace (voir api/client-login.js) — reste lisible
        // dans Stripe même si tout le reste devait être reconstitué à la main.
        ref:               (resa?.ref || '').slice(0, 500),
        prenom:            (resa?.prenom || '').slice(0, 500),
        nom:               (resa?.nom || '').slice(0, 500),
        email:             (resa?.email || '').slice(0, 500),
        tel:               (resa?.tel || '').slice(0, 500),
        appareil_id:       String(offre.appareil_id),
        appareil_numero:   String(appareil?.numero ?? ''),
        appareil_reference: (appareil?.reference || '').slice(0, 500),
      },
    });

    await supabase.from('offres_privilege').update({ stripe_payment_intent_id: intent.id }).eq('id', offre.id);

    return res.status(200).json({ clientSecret: intent.client_secret, amountCents: offre.prix_vente_cents });
  } catch (err) {
    console.error('[Offre privilège pay]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
