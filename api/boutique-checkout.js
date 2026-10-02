const Stripe = require('stripe');
const { getSupabase } = require('./_lib/supabase');
const { expressPossible } = require('./_lib/dates');
const { getProduitVentePourPaiement, OPTIONS_VENTE, prixInstallationVente } = require('./_lib/vente');

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
// Le client n'envoie qu'un identifiant de modèle, une ville et deux cases
// cochées (express, installation). Le montant est relu dans le catalogue et
// dans OPTIONS_VENTE, côté serveur. S'il pouvait envoyer un
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
  const express      = body.express === true;
  const installation = body.installation === true;
  if ((express || installation) && ville !== 'Nice') {
    return res.status(400).json({ error: "L'Express et l'installation ne sont proposés qu'à Nice." });
  }
  if (express && !expressPossible()) {
    return res.status(400).json({ error: "L'Express n'est plus possible après 18 h. Décochez-le : nous livrons dès demain." });
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
      express:        express ? 'oui' : 'non',
      installation:   installation ? 'oui' : 'non',
    };

    const lignes = [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: produit.prix_vente_cents,
        product_data: {
          name: modele,
          description: 'Climatiseur mobile neuf, livré à ' + ville + '.',
        },
      },
    }];
    const installCents = installation ? prixInstallationVente(produit) : 0;
    if (installation && installCents > 0) {
      lignes.push({
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: installCents,
          product_data: { name: 'Installation par un technicien', description: 'Kit fenêtre posé, appareil branché, réglages expliqués.' },
        },
      });
    }
    const livraison = ville === 'Paris'
      ? { nom: 'Chronopost — livraison à Paris', cents: OPTIONS_VENTE.livraison_cents }
      : express
        ? { nom: 'Livraison Express sous 2 h — Nice', cents: OPTIONS_VENTE.livraison_cents + OPTIONS_VENTE.express_cents }
        : { nom: 'Livraison à Nice', cents: OPTIONS_VENTE.livraison_cents };

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lignes,
      // Une vente se livre : il faut une adresse, en France.
      shipping_address_collection: { allowed_countries: ['FR'] },
      // La livraison est une option payante, choisie sur la boutique. Une
      // seule ligne, déjà décidée : le client la VOIT sur la page de paiement.
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: livraison.cents, currency: 'eur' },
          display_name: livraison.nom,
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
