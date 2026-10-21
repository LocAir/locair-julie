// AdStay : toutes les données affichées sur la tablette.
// Étape 1 (MVP) : on modifie ce fichier à la main.
// Étape 2 : ces données viendront d'une base (Supabase) gérée depuis un back-office.
//
// Les commerçants ci-dessous sont des EXEMPLES inventés, pour la démo.

window.ADSTAY = {
  ville: {
    nom: 'Nice', lat: 43.7031, lon: 7.2661,
    region: 'La Côte d’Azur · French Riviera',
    photo: '/ville-nice-900.jpg', // grande photo de la diapo d'accueil du diaporama
  },

  // Contact affiché sur la page « Devenir partenaire ». Vide = bouton masqué.
  contact: { email: '', tel: '' },

  // Délai sans toucher l'écran avant le diaporama (secondes) et durée d'une diapo.
  veille: { apresSecondes: 90, dureeDiapo: 8 },

  // Formules publicitaires. Prix modifiables ici, rien n'est codé en dur ailleurs.
  // rang : plus il est haut, plus le commerçant remonte dans la liste.
  // diaporama : nombre d'apparitions par tour dans le diaporama de veille (0 = jamais).
  formules: [
    {
      id: 'essentielle', nom: 'Essentielle', prix: 39, rang: 1, diaporama: 0, badge: '',
      pour: 'Pour un petit commerçant ou un restaurant',
      avantages: ['Présence dans une catégorie', 'Nom, photo, adresse et coordonnées', 'Accès à un réseau local de logements'],
    },
    {
      id: 'premium', nom: 'Premium', prix: 79, rang: 2, diaporama: 1, badge: 'Recommandé',
      pour: 'Pour les établissements qui veulent plus de visibilité',
      avantages: ['Mise en avant prioritaire', 'Offre spéciale pour les voyageurs', 'Bouton de réservation ou de contact', 'Présence dans le diaporama de veille'],
    },
    {
      id: 'exclusivite', nom: 'Exclusivité', prix: 149, rang: 3, diaporama: 2, badge: 'Coup de cœur',
      pour: 'Pour une catégorie ou une zone géographique',
      avantages: ['Visibilité renforcée, en tête de liste', 'Possibilité d’exclusivité par catégorie', 'Diaporama de veille ×2', 'Statistiques et bilan mensuel'],
    },
  ],

  // Qui reçoit les demandes de services du voyageur (ménage, linge…).
  // whatsapp : numéro au format international sans + ni espaces, ex. '33612345678'.
  // Le voyageur scanne un QR code : WhatsApp s'ouvre avec la demande déjà écrite.
  // Le nom du logement vient de l'adresse de la tablette : /adstay?logement=Port-3B
  conciergerie: { nom: 'Votre conciergerie', whatsapp: '', tel: '' },

  // Infos pratiques de chaque logement, choisies par l'adresse de la tablette :
  // /adstay?logement=Port-3B  → le logement 'Port-3B' ci-dessous.
  // Sans ?logement=, la tablette montre le premier (pratique pour la démo).
  // Le QR Wi-Fi connecte le téléphone du voyageur sans rien taper.
  logements: {
    'Port-3B': {
      nom: 'Appartement du Port',
      wifi: { reseau: 'Riviera-Invites', motdepasse: 'bienvenue2026' },
      arrivee: '16h00', depart: '11h00',
      infos: [
        'Climatisation : télécommande dans le tiroir de l’entrée.',
        'Poubelles : local dans la cour, à gauche en sortant.',
        'Calme après 22h, merci pour les voisins.',
        'Clés : à laisser sur la table du salon le jour du départ.',
      ],
    },
  },

  // Boutique de services du séjour. Prix = texte libre (vide = « sur demande »).
  services: [
    { id: 's1', nom: 'Ménage supplémentaire', icone: 'menage', prix: 'à partir de 40 €',
      description: 'Un ménage complet du logement pendant votre séjour, au créneau qui vous arrange.' },
    { id: 's2', nom: 'Linge propre', icone: 'linge', prix: '15 € / personne',
      description: 'Draps et serviettes propres, livrés et changés par notre équipe.' },
    { id: 's3', nom: 'Lit bébé', icone: 'bebe', prix: '10 € / séjour',
      description: 'Lit parapluie avec matelas et draps, installé dans le logement.' },
    { id: 's4', nom: 'Départ tardif', icone: 'horloge', prix: '25 €',
      description: 'Gardez le logement jusqu’à 15h le jour du départ (selon disponibilité).' },
    { id: 's5', nom: 'Arrivée anticipée', icone: 'cle', prix: '25 €',
      description: 'Entrez dans le logement dès 11h le jour de votre arrivée (selon disponibilité).' },
    { id: 's6', nom: 'Livraison de courses', icone: 'courses', prix: 'frais de 10 €',
      description: 'Envoyez votre liste : nous faisons les courses et les déposons au logement.' },
  ],

  categories: [
    { id: 'restaurants', nom: 'Restaurants', icone: 'restaurant' },
    { id: 'bars', nom: 'Cafés & bars', icone: 'bar' },
    { id: 'plages', nom: 'Plages privées', icone: 'plage' },
    { id: 'activites', nom: 'Activités', icone: 'activite' },
    { id: 'transport', nom: 'VTC & taxis', icone: 'voiture' },
    { id: 'location', nom: 'Location véhicules', icone: 'scooter' },
    { id: 'boutiques', nom: 'Boutiques & services', icone: 'boutique' },
  ],

  // photo : URL d'une image (photos d'illustration Unsplash pour la démo).
  // couleur : teintes de secours si pas de photo. lien : site / réservation (sert au QR code).
  commercants: [
    { id: 'c1', photo: 'https://images.unsplash.com/photo-1529543544282-ea669407fca3', nom: 'La Table du Port', categorie: 'restaurants', formule: 'exclusivite',
      accroche: 'Poissons du jour face aux bateaux', couleur: ['#0e4d64', '#c8a24a'],
      description: 'Cuisine niçoise et poissons de la pêche locale, servis en terrasse sur le port Lympia.',
      adresse: 'Quai des Docks, Nice', tel: '04 00 00 00 01', horaires: '12h–14h30 · 19h–22h30',
      offre: 'Apéritif offert sur présentation de la tablette', lien: '' },
    { id: 'c2', photo: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0', nom: 'Chez Mamé Socca', categorie: 'restaurants', formule: 'premium',
      accroche: 'La vraie socca, cuite au feu de bois', couleur: ['#7a3b12', '#e0a25a'],
      description: 'Socca, pissaladière et petits farcis. Une adresse simple et authentique dans le Vieux-Nice.',
      adresse: 'Vieux-Nice', tel: '04 00 00 00 02', horaires: '11h–21h',
      offre: '-10 % sur l’addition', lien: '' },
    { id: 'c3', photo: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4', nom: 'Trattoria Garibaldi', categorie: 'restaurants', formule: 'essentielle',
      accroche: 'Pâtes fraîches et pizzas', couleur: ['#3d5a2a', '#b9c46a'],
      description: 'Trattoria familiale, pâtes faites maison chaque matin.',
      adresse: 'Place Garibaldi, Nice', tel: '04 00 00 00 03', horaires: '12h–23h', offre: '', lien: '' },
    { id: 'c4', photo: 'https://images.unsplash.com/photo-1470337458703-46ad1756a187', nom: 'Le Comptoir Bleu', categorie: 'bars', formule: 'premium',
      accroche: 'Cocktails au coucher du soleil', couleur: ['#1b2a6b', '#e07a5f'],
      description: 'Bar à cocktails avec vue sur la Baie des Anges. DJ le vendredi et le samedi.',
      adresse: 'Promenade des Anglais, Nice', tel: '04 00 00 00 04', horaires: '17h–1h',
      offre: 'Happy hour prolongée jusqu’à 21h', lien: '' },
    { id: 'c5', photo: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085', nom: 'Café des Fleurs', categorie: 'bars', formule: 'essentielle',
      accroche: 'Petit-déjeuner au marché', couleur: ['#6b2d5c', '#f2b5d4'],
      description: 'Café, viennoiseries et jus pressés à deux pas du marché aux fleurs.',
      adresse: 'Cours Saleya, Nice', tel: '04 00 00 00 05', horaires: '7h–18h', offre: '', lien: '' },
    { id: 'c6', photo: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e', nom: 'Azur Beach Club', categorie: 'plages', formule: 'exclusivite',
      accroche: 'Transats, déjeuner les pieds dans l’eau', couleur: ['#0a6c8f', '#7fd6e8'],
      description: 'Plage privée avec transats, restaurant et service au matelas. Réservation conseillée en été.',
      adresse: 'Promenade des Anglais, Nice', tel: '04 00 00 00 06', horaires: '9h–19h',
      offre: 'Transat offert pour un déjeuner', lien: '' },
    { id: 'c7', photo: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5', nom: 'Cap Plongée', categorie: 'activites', formule: 'premium',
      accroche: 'Baptêmes et plongées dans les criques', couleur: ['#11604a', '#79d1a8'],
      description: 'Plongées encadrées le long de la côte, baptêmes pour débutants, matériel fourni.',
      adresse: 'Port de Nice', tel: '06 00 00 00 07', horaires: '9h–18h',
      offre: '-15 % pour les voyageurs AdStay', lien: '' },
    { id: 'c8', photo: 'https://images.unsplash.com/photo-1533105079780-92b9be482077', nom: 'Riviera Excursions', categorie: 'activites', formule: 'essentielle',
      accroche: 'Monaco, Èze, Saint-Paul en minibus', couleur: ['#4a3b8f', '#b8a8f0'],
      description: 'Excursions à la journée ou à la demi-journée sur la Côte d’Azur.',
      adresse: 'Nice centre', tel: '06 00 00 00 08', horaires: 'Départs 8h et 13h', offre: '', lien: '' },
    { id: 'c9', photo: 'https://images.unsplash.com/photo-1601362840469-51e4d8d58785', nom: 'Elite Transfert', categorie: 'transport', formule: 'exclusivite',
      accroche: 'Aéroport ↔ logement, prix fixe', couleur: ['#111827', '#9ca3af'],
      description: 'Chauffeurs privés 24h/24. Transferts aéroport, gare et soirées. Paiement par carte.',
      adresse: 'Nice et alentours', tel: '06 00 00 00 09', horaires: '24h/24',
      offre: 'Transfert aéroport à prix fixe', lien: '' },
    { id: 'c10', photo: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39', nom: 'Scoot’Azur', categorie: 'location', formule: 'premium',
      accroche: 'Scooters et vélos électriques', couleur: ['#8f2d1a', '#f4a261'],
      description: 'Location à l’heure, à la journée ou à la semaine. Casques fournis.',
      adresse: 'Rue de France, Nice', tel: '04 00 00 00 10', horaires: '9h–19h',
      offre: '2e jour à -50 %', lien: '' },
    { id: 'c11', photo: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8', nom: 'Maison Riviera', categorie: 'boutiques', formule: 'essentielle',
      accroche: 'Concept store : mode, déco, souvenirs', couleur: ['#5c4a1f', '#d9c27a'],
      description: 'Créateurs locaux, linge de plage, objets de déco et idées cadeaux.',
      adresse: 'Libération, Nice', tel: '04 00 00 00 11', horaires: '10h–19h30', offre: '', lien: '' },
  ],
};
