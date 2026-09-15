const Stripe = require('stripe');
const { getSupabase } = require('./_lib/supabase');
const { getProduitVentePourPaiement } = require('./_lib/vente');

// Paiement d'un ACHAT depuis /boutique — voir migration_vente_catalogue.sql.
//
// ── CE QUE CE FICHIER NE FAIT PAS ──
// Il ne touche jamais à `reservations`, ni au tunnel de location. Une vente
// n'a pas de date de fin, pas de récupération, pas de caution : la faire
// passer par le flux de location produirait une réservation fantôme qu'un
// transporteur irait chercher chez un client qui a ACHETÉ sa machine.
// C'est aussi pour ça que webhook.js apprend à reconnaître type_commande
// = 'vente' et à s'arrêter là (voir la garde ajoutée à côté de celles de
// l'Offre Privilège et de la prolongation).
//
// ── LE PRIX NE VIENT JAMAIS DU NAVIGATEUR ──
// Le client n'envoie qu'un identifiant de modèle et une ville. Le montant
// est relu dans le catalogue, côté serveur. S'il pouvait envoyer un
// montant, n'importe qui achèterait une machine à 1 €.

// Les deux seules villes de livraison, en dur et côté serveur. Le <select>
// de la page dit la même chose, mais un <select> se contourne en trois
// secondes avec les outils du navigateur : c'est cette liste-ci qui fait foi.
const VILLES = ['Nice', 'Paris'];

const SITE = 'https://www.locair.fr';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const ville = String(body.ville || '').trim();
  if (!VILLES.includes(ville)) {
    return res.status(400).json({ error: 'Choisissez une ville de livraison.' });
  }

  try {
    const produit = await getProduitVentePourPaiement(getSupabase(), body.modele_id);
    if (!produit) {
      // Modèle inconnu, retiré de la vente, sans prix, ou en rupture — et
      // aussi le cas où la migration n'est pas encore appliquée. Un seul
      // message : le visiteur n'a pas à connaître nos états internes.
      return res.status(409).json({ error: "Ce modèle n'est plus disponible à la vente." });
    }

    const modele = [produit.marque, produit.modele].filter(Boolean).join(' ');

    // Les mêmes clés dans la session ET dans le PaymentIntent. Stripe émet
    // les deux événements (checkout.session.completed ET
    // payment_intent.succeeded) et webhook.js les traite tous les deux :
    // si seule la session portait la marque, l'événement du PaymentIntent
    // retomberait dans la branche « réservation de location ».
    const metadata = {
      type_commande:  'vente',
      ville_livraison: ville,
      modele,
      modele_id:      String(produit.id),
    };

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: produit.prix_vente_cents,
          product_data: {
            name: modele,
            description: 'Climatiseur mobile neuf — livraison comprise, livré à ' + ville + '.',
          },
        },
      }],
      // Une vente s'expédie : il faut une adresse. Restreinte à la France,
      // parce que c'est la seule zone que Chronopost couvre dans ce cadre.
      shipping_address_collection: { allowed_countries: ['FR'] },
      // Un seul mode, à zéro : la livraison est déjà dans le prix affiché.
      // L'écrire comme une ligne à 0 € plutôt que de la taire, pour que le
      // client le VOIE sur la page de paiement.
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: 0, currency: 'eur' },
          display_name: 'Chronopost — livraison offerte',
        },
      }],
      payment_intent_data: {
        description: "Loc'Air — achat " + modele,
        metadata,
      },
      metadata,
      success_url: SITE + '/boutique?achat=confirme',
      cancel_url:  SITE + '/boutique?achat=annule',
    });

    if (!session || !session.url) throw new Error('Session sans URL');
    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('[boutique-checkout]', err.message);
    return res.status(500).json({ error: 'Le paiement n’a pas pu démarrer. Réessayez dans un instant.' });
  }
};
