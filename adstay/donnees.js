// AdStay : toutes les données affichées sur la tablette.
// Étape 1 (MVP) : on modifie ce fichier à la main.
// Étape 2 : ces données viendront d'une base (Supabase) gérée depuis un back-office.
//
// Les commerçants ci-dessous sont des EXEMPLES inventés, pour la démo.

window.ADSTAY = {
  ville: {
    nom: 'Nice', lat: 43.7031, lon: 7.2661,
    region: 'La Côte d’Azur · French Riviera',
    photo: 'https://images.unsplash.com/photo-1643914729809-4aa59fdc4c17', // Baie des Anges (Unsplash, très haute définition)
  },

  // Contact affiché sur la page « Devenir partenaire ». Vide = bouton masqué.
  contact: { email: '', tel: '' },

  // Profils voyageurs : la tablette demande « Vous voyagez… » et met en avant les adresses
  // dont « pour » contient ce profil (à formule égale ; la formule payée reste prioritaire).
  profils: [
    { id: 'couple', nom: 'En couple', nom_en: 'As a couple', icone: 'coeur' },
    { id: 'famille', nom: 'En famille', nom_en: 'With family', icone: 'famille' },
    { id: 'amis', nom: 'Entre amis', nom_en: 'With friends', icone: 'amis' },
    { id: 'travail', nom: 'Pour le travail', nom_en: 'For work', icone: 'valise' },
  ],

  // Mode nuit automatique : écran sombre et doux entre ces deux heures (actif: false pour couper).
  nuit: { actif: true, debut: '22:00', fin: '06:30' },

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
      id: 'premium', nom: 'Premium', prix: 79, rang: 2, diaporama: 1, badge: 'Recommandé', badge_en: 'Recommended',
      pour: 'Pour les établissements qui veulent plus de visibilité',
      avantages: ['Annonce dans le bandeau défilant de l’accueil', 'Offre du jour avec compte à rebours', 'Offre spéciale et bouton de réservation', 'Plein écran sur l’écran de veille'],
    },
    {
      id: 'exclusivite', nom: 'Exclusivité', prix: 149, rang: 3, diaporama: 2, badge: 'Coup de cœur', badge_en: 'Our pick',
      pour: 'Pour une catégorie ou une zone géographique',
      avantages: ['La grande carte « À la une » de l’accueil', 'Seul de votre catégorie à ce niveau', 'Tout Premium, et le plein écran ×2', 'Statistiques et bilan mensuel'],
    },
  ],

  // ─── Page de vente (/adstay/partenaires) ──────────────────────────────────
  // Comparatif : chaque ligne indique dans quelles formules l'avantage est inclus.
  // Ces règles correspondent à ce que la tablette fait vraiment (ne pas promettre plus).
  vente: {
    // Places « Exclusivité » vendues par catégorie (la carte « À la une » tourne entre elles).
    placesExclusiviteParCategorie: 1,
    comparatif: [
      { texte: 'Fiche complète : photo, description, adresse, horaires, téléphone', formules: ['essentielle', 'premium', 'exclusivite'] },
      { texte: 'Badges « Ouvert maintenant » et « 8 min à pied »', formules: ['essentielle', 'premium', 'exclusivite'] },
      { texte: 'QR code itinéraire sur la fiche', formules: ['essentielle', 'premium', 'exclusivite'] },
      { texte: 'Statistiques en ligne : fiches ouvertes, QR scannés', formules: ['essentielle', 'premium', 'exclusivite'] },
      { texte: 'Offre spéciale voyageurs mise en valeur', formules: ['premium', 'exclusivite'] },
      { texte: 'Bouton et QR de réservation (votre site, TheFork…)', formules: ['premium', 'exclusivite'] },
      { texte: 'Étiquette dorée et place prioritaire dans la liste', formules: ['premium', 'exclusivite'] },
      { texte: 'Annonce dans le bandeau défilant de l’accueil', formules: ['premium', 'exclusivite'] },
      { texte: 'Offre du jour avec compte à rebours en direct', formules: ['premium', 'exclusivite'] },
      { texte: 'Plein écran sur l’écran de veille (avec QR)', formules: ['premium', 'exclusivite'], detail: { premium: '1 passage par tour', exclusivite: '2 passages par tour' } },
      { texte: 'Grande carte « À la une » sur l’accueil', formules: ['exclusivite'] },
      { texte: 'Exclusivité dans votre catégorie', formules: ['exclusivite'] },
      { texte: 'Bilan mensuel commenté', formules: ['exclusivite'] },
    ],
    faq: [
      { q: 'Combien de temps faut-il pour être visible ?', r: 'Créez votre fiche en 10 minutes. Après validation, elle apparaît sur toutes les tablettes du réseau, en général sous 48 heures.' },
      { q: 'Y a-t-il un engagement ?', r: 'Non. L’abonnement est mensuel, sans durée minimum. Vous pouvez changer de formule ou arrêter quand vous voulez.' },
      { q: 'Comment savoir si ça marche ?', r: 'Votre espace affiche chaque jour combien de voyageurs ont ouvert votre fiche, vu votre publicité en veille et scanné votre QR code.' },
      { q: 'Qui voit ma publicité ?', r: 'Les voyageurs logés dans les appartements et villas équipés de nos tablettes : des touristes déjà sur place, qui cherchent où manger, sortir ou se déplacer.' },
      { q: 'Comment fonctionne l’Offre du jour ?', r: 'Vous choisissez un créneau (ex. 17h–21h) et une promotion. Pendant ce créneau, elle s’affiche en grand sur l’accueil avec un compte à rebours. Si plusieurs offres tombent en même temps, celle qui se termine le plus tôt passe devant.' },
      { q: 'Puis-je proposer une offre aux voyageurs ?', r: 'Oui, à partir de la formule Premium : un apéritif offert, une remise, un transat… Elle s’affiche en valeur sur votre fiche et en plein écran.' },
    ],
  },

  // Qui reçoit les demandes de services du voyageur (ménage, linge…).
  // whatsapp : numéro au format international sans + ni espaces, ex. '33612345678'.
  // Le voyageur scanne un QR code : WhatsApp s'ouvre avec la demande déjà écrite.
  conciergerie: { nom: 'Votre conciergerie', whatsapp: '', tel: '' },

  // ─── Traductions ───────────────────────────────────────────────────────────
  // Partout : un champ « xxx_en » donne la version anglaise de « xxx ».
  // S'il manque, la tablette affiche le français.

  // Base branchée : les logements se gèrent dans l'espace admin (onglet « Logements et tablettes »)
  // et chaque tablette s'installe avec son QR code. Ce qui suit ne sert qu'à la démo.
  // Infos pratiques de chaque logement, choisies par l'adresse de la tablette :
  // /adstay?logement=Port-3B  → le logement 'Port-3B' ci-dessous.
  // Sans ?logement=, la tablette montre le premier (pratique pour la démo).
  // lat / lon : position du logement, sert à calculer « 8 min à pied ».
  logements: {
    'Port-3B': {
      nom: 'Appartement du Port', lat: 43.6985, lon: 7.2830,
      // Séjour en cours : prénoms et dates (AAAA-MM-JJ). Vide = accueil sans prénom.
      // À remplir à chaque arrivée (plus tard depuis l'espace admin). Exemple pour la démo :
      sejour: { prenoms: 'Sophie & Marc', du: '2026-10-20', au: '2026-10-26' },
      // Petit mot affiché en haut de « Votre séjour ».
      motHote: {
        texte: 'Bienvenue chez vous ! Nous avons préparé ce guide avec nos adresses préférées du quartier. Une question, une envie ? Écrivez-nous, nous répondons vite.',
        texte_en: 'Welcome home! We put together this guide with our favourite places in the neighbourhood. Any question or request? Message us, we reply quickly.',
        signature: 'L’équipe de la conciergerie', signature_en: 'The concierge team',
      },
      wifi: { reseau: 'Riviera-Invites', motdepasse: 'bienvenue2026' },
      arrivee: '16h00', depart: '11h00',
      infos: [
        'Climatisation : télécommande dans le tiroir de l’entrée.',
        'Poubelles : local dans la cour, à gauche en sortant.',
        'Calme après 22h, merci pour les voisins.',
        'Clés : à laisser sur la table du salon le jour du départ.',
      ],
      infos_en: [
        'Air conditioning: the remote is in the hallway drawer.',
        'Bins: in the courtyard, on your left as you go out.',
        'Quiet after 10 pm, thank you for the neighbours.',
        'Keys: please leave them on the living-room table when you leave.',
      ],
    },
  },

  // Boutique de services du séjour. Prix = texte libre (vide = « sur demande »).
  services: [
    { id: 's1', icone: 'menage', nom: 'Ménage supplémentaire', nom_en: 'Extra cleaning',
      prix: 'à partir de 40 €', prix_en: 'from €40',
      description: 'Un ménage complet du logement pendant votre séjour, au créneau qui vous arrange.',
      description_en: 'A full clean of the apartment during your stay, at a time that suits you.' },
    { id: 's2', icone: 'linge', nom: 'Linge propre', nom_en: 'Fresh linen',
      prix: '15 € / personne', prix_en: '€15 / person',
      description: 'Draps et serviettes propres, livrés et changés par notre équipe.',
      description_en: 'Fresh sheets and towels, delivered and changed by our team.' },
    { id: 's3', icone: 'bebe', nom: 'Lit bébé', nom_en: 'Baby cot',
      prix: '10 € / séjour', prix_en: '€10 / stay',
      description: 'Lit parapluie avec matelas et draps, installé dans le logement.',
      description_en: 'Travel cot with mattress and sheets, set up in the apartment.' },
    { id: 's4', icone: 'horloge', nom: 'Départ tardif', nom_en: 'Late check-out',
      prix: '25 €', prix_en: '€25',
      description: 'Gardez le logement jusqu’à 15h le jour du départ (selon disponibilité).',
      description_en: 'Keep the apartment until 3 pm on your departure day (subject to availability).' },
    { id: 's5', icone: 'cle', nom: 'Arrivée anticipée', nom_en: 'Early check-in',
      prix: '25 €', prix_en: '€25',
      description: 'Entrez dans le logement dès 11h le jour de votre arrivée (selon disponibilité).',
      description_en: 'Get into the apartment from 11 am on your arrival day (subject to availability).' },
    { id: 's6', icone: 'courses', nom: 'Livraison de courses', nom_en: 'Grocery delivery',
      prix: 'frais de 10 €', prix_en: '€10 fee',
      description: 'Envoyez votre liste : nous faisons les courses et les déposons au logement.',
      description_en: 'Send us your list: we do the shopping and drop it at the apartment.' },
  ],

  categories: [
    { id: 'restaurants', nom: 'Restaurants', nom_en: 'Restaurants', court: 'Manger', court_en: 'Eat', icone: 'restaurant' },
    { id: 'bars', nom: 'Cafés & bars', nom_en: 'Cafés & bars', court: 'Sortir', court_en: 'Drinks', icone: 'bar' },
    { id: 'plages', nom: 'Plages privées', nom_en: 'Beach clubs', court: 'Plages', court_en: 'Beaches', icone: 'plage' },
    { id: 'activites', nom: 'Activités', nom_en: 'Activities', court: 'Activités', court_en: 'Activities', icone: 'activite' },
    { id: 'transport', nom: 'VTC & taxis', nom_en: 'Taxis & drivers', court: 'Taxis', court_en: 'Taxis', icone: 'voiture' },
    { id: 'location', nom: 'Location véhicules', nom_en: 'Rentals', court: 'Louer', court_en: 'Rent', icone: 'scooter' },
    { id: 'boutiques', nom: 'Boutiques & services', nom_en: 'Shops & services', court: 'Shopping', court_en: 'Shopping', icone: 'boutique' },
  ],

  // photo : URL d'une image (photos d'illustration Unsplash pour la démo).
  // lien : site / réservation (sert au QR code).
  // lat / lon : position, pour « 8 min à pied » (vide pour un service qui se déplace).
  // creneaux : heures d'ouverture, ex. '12:00-14:30 19:00-22:30' (après minuit : '17:00-01:00').
  // fermes : jours de fermeture parmi 'lun','mar','mer','jeu','ven','sam','dim'.
  // → la tablette affiche « Ouvert · ferme à 22h30 » ou « Fermé · ouvre à 19h ».
  commercants: [
    { id: 'c1', pour: ['couple', 'famille', 'travail'], photo: 'https://images.unsplash.com/photo-1529543544282-ea669407fca3', nom: 'La Table du Port', categorie: 'restaurants', formule: 'exclusivite',
      accroche: 'Poissons du jour face aux bateaux', accroche_en: 'Catch of the day, facing the boats',
      description: 'Cuisine niçoise et poissons de la pêche locale, servis en terrasse sur le port Lympia.',
      description_en: 'Niçoise cooking and locally caught fish, served on a terrace overlooking Lympia harbour.',
      adresse: 'Quai des Docks, Nice', tel: '04 00 00 00 01', lat: 43.6955, lon: 7.2855,
      creneaux: '12:00-14:30 19:00-22:30', fermes: ['lun'],
      offre: 'Apéritif offert sur présentation de la tablette', offre_en: 'Free aperitif when you mention the tablet', lien: '' },
    { id: 'c2', pour: ['famille', 'amis'], photo: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0', nom: 'Chez Mamé Socca', categorie: 'restaurants', formule: 'premium',
      accroche: 'La vraie socca, cuite au feu de bois', accroche_en: 'Real socca, baked over a wood fire',
      description: 'Socca, pissaladière et petits farcis. Une adresse simple et authentique dans le Vieux-Nice.',
      description_en: 'Socca, pissaladière and stuffed vegetables. A simple, authentic spot in Old Nice.',
      adresse: 'Vieux-Nice', tel: '04 00 00 00 02', lat: 43.6977, lon: 7.2765, creneaux: '11:00-21:00',
      offre: '-10 % sur l’addition', offre_en: '10% off the bill', lien: '' },
    { id: 'c3', pour: ['famille', 'amis'], photo: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4', nom: 'Trattoria Garibaldi', categorie: 'restaurants', formule: 'essentielle',
      accroche: 'Pâtes fraîches et pizzas', accroche_en: 'Fresh pasta and pizza',
      description: 'Trattoria familiale, pâtes faites maison chaque matin.',
      description_en: 'Family trattoria, pasta made fresh every morning.',
      adresse: 'Place Garibaldi, Nice', tel: '04 00 00 00 03', lat: 43.7010, lon: 7.2810, creneaux: '12:00-23:00', offre: '', lien: '' },
    { id: 'c4', pour: ['couple', 'amis'], photo: 'https://images.unsplash.com/photo-1470337458703-46ad1756a187', nom: 'Le Comptoir Bleu', categorie: 'bars', formule: 'premium',
      accroche: 'Cocktails au coucher du soleil', accroche_en: 'Sunset cocktails',
      description: 'Bar à cocktails avec vue sur la Baie des Anges. DJ le vendredi et le samedi.',
      description_en: 'Cocktail bar overlooking the Baie des Anges. DJ on Fridays and Saturdays.',
      adresse: 'Promenade des Anglais, Nice', tel: '04 00 00 00 04', lat: 43.6950, lon: 7.2600, creneaux: '17:00-01:00',
      offre: 'Happy hour prolongée jusqu’à 21h', offre_en: 'Happy hour extended until 9 pm', lien: '' },
    { id: 'c5', pour: ['couple', 'famille', 'travail'], photo: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085', nom: 'Café des Fleurs', categorie: 'bars', formule: 'essentielle',
      accroche: 'Petit-déjeuner au marché', accroche_en: 'Breakfast at the market',
      description: 'Café, viennoiseries et jus pressés à deux pas du marché aux fleurs.',
      description_en: 'Coffee, pastries and fresh juice, steps from the flower market.',
      adresse: 'Cours Saleya, Nice', tel: '04 00 00 00 05', lat: 43.6955, lon: 7.2755, creneaux: '07:00-18:00', offre: '', lien: '' },
    { id: 'c6', pour: ['couple', 'amis', 'famille'], photo: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e', nom: 'Azur Beach Club', categorie: 'plages', formule: 'exclusivite',
      accroche: 'Transats, déjeuner les pieds dans l’eau', accroche_en: 'Sunbeds and lunch by the water',
      description: 'Plage privée avec transats, restaurant et service au matelas. Réservation conseillée en été.',
      description_en: 'Private beach with sunbeds, restaurant and service to your lounger. Booking advised in summer.',
      adresse: 'Promenade des Anglais, Nice', tel: '04 00 00 00 06', lat: 43.6940, lon: 7.2650, creneaux: '09:00-19:00',
      offre: 'Transat offert pour un déjeuner', offre_en: 'Free sunbed with lunch', lien: '' },
    { id: 'c7', pour: ['amis', 'couple'], photo: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5', nom: 'Cap Plongée', categorie: 'activites', formule: 'premium',
      accroche: 'Baptêmes et plongées dans les criques', accroche_en: 'Dives and first dives in hidden coves',
      description: 'Plongées encadrées le long de la côte, baptêmes pour débutants, matériel fourni.',
      description_en: 'Guided dives along the coast, first dives for beginners, equipment provided.',
      adresse: 'Port de Nice', tel: '06 00 00 00 07', lat: 43.6965, lon: 7.2850, creneaux: '09:00-18:00',
      offre: '-15 % pour les voyageurs AdStay', offre_en: '15% off for AdStay guests', lien: '' },
    { id: 'c8', pour: ['famille', 'couple'], photo: 'https://images.unsplash.com/photo-1533105079780-92b9be482077', nom: 'Riviera Excursions', categorie: 'activites', formule: 'essentielle',
      accroche: 'Monaco, Èze, Saint-Paul en minibus', accroche_en: 'Monaco, Èze, Saint-Paul by minibus',
      description: 'Excursions à la journée ou à la demi-journée sur la Côte d’Azur.',
      description_en: 'Full-day and half-day trips along the French Riviera.',
      adresse: 'Nice centre', tel: '06 00 00 00 08', lat: 43.7010, lon: 7.2690, creneaux: '08:00-17:00', offre: '', lien: '' },
    { id: 'c9', pour: ['travail', 'couple'], photo: 'https://images.unsplash.com/photo-1601362840469-51e4d8d58785', nom: 'Elite Transfert', categorie: 'transport', formule: 'exclusivite',
      accroche: 'Aéroport ↔ logement, prix fixe', accroche_en: 'Airport ↔ apartment, fixed price',
      description: 'Chauffeurs privés 24h/24. Transferts aéroport, gare et soirées. Paiement par carte.',
      description_en: 'Private drivers 24/7. Airport, station and evening transfers. Card payment.',
      adresse: 'Nice et alentours', tel: '06 00 00 00 09', creneaux: '00:00-24:00',
      offre: '−10 % pour les voyageurs AdStay', offre_en: '10% off for AdStay guests', lien: '' },
    { id: 'c10', pour: ['amis', 'couple'], photo: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39', nom: 'Scoot’Azur', categorie: 'location', formule: 'premium',
      accroche: 'Scooters et vélos électriques', accroche_en: 'Scooters and e-bikes',
      description: 'Location à l’heure, à la journée ou à la semaine. Casques fournis.',
      description_en: 'Rent by the hour, day or week. Helmets included.',
      adresse: 'Rue de France, Nice', tel: '04 00 00 00 10', lat: 43.6965, lon: 7.2580, creneaux: '09:00-19:00', fermes: ['dim'],
      offre: '2e jour à -50 %', offre_en: '2nd day half price', lien: '' },
    { id: 'c11', pour: ['couple', 'famille'], photo: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8', nom: 'Maison Riviera', categorie: 'boutiques', formule: 'essentielle',
      accroche: 'Concept store : mode, déco, souvenirs', accroche_en: 'Concept store: fashion, decor, gifts',
      description: 'Créateurs locaux, linge de plage, objets de déco et idées cadeaux.',
      description_en: 'Local designers, beach linen, decor and gift ideas.',
      adresse: 'Libération, Nice', tel: '04 00 00 00 11', lat: 43.7120, lon: 7.2620, creneaux: '10:00-19:30', fermes: ['dim'], offre: '', lien: '' },
  ],

  // ─── Offre du jour (encart « urgence » de l'accueil, de la fiche et de la veille) ─
  // debut / fin : créneau de la journée où l'offre est valable (HH:MM).
  // jours : jours où elle a lieu (vide = tous les jours). rarete : texte libre fourni
  // par le commerçant (ex. « Plus que 4 places ») — à tenir à jour, ne rien inventer.
  // Réservé aux commerçants Premium et Exclusivité. Si plusieurs sont en cours,
  // celle qui se termine le plus tôt passe devant (la plus urgente).
  promos: [
    { commercant: 'c7', debut: '08:00', fin: '13:00', valeur: '−25 %', valeur_en: '25% off',
      titre: 'Baptême de plongée ce matin', titre_en: 'First dive this morning',
      rarete: 'Plus que 4 places', rarete_en: 'Only 4 spots left', code: 'ADSTAY-PLONGEE' },
    { commercant: 'c6', debut: '11:00', fin: '15:00', valeur: 'Transat offert', valeur_en: 'Free sunbed',
      titre: 'Pour tout déjeuner sur la plage', titre_en: 'With any lunch on the beach',
      rarete: 'Places limitées', rarete_en: 'Limited spots', code: 'ADSTAY-SOLEIL' },
    { commercant: 'c4', debut: '17:00', fin: '21:00', valeur: '1 = 2', valeur_en: '2 for 1',
      titre: 'Cocktail offert au coucher du soleil', titre_en: 'Free cocktail at sunset',
      rarete: '', code: 'ADSTAY-SUNSET' },
    { commercant: 'c1', debut: '19:00', fin: '22:30', valeur: '−20 %', valeur_en: '20% off',
      titre: 'Menu dégustation face au port', titre_en: 'Tasting menu by the harbour',
      rarete: 'Plus que 3 tables ce soir', rarete_en: 'Only 3 tables left tonight', code: 'ADSTAY-PORT' },
  ],

  // ─── Événements et rendez-vous de la semaine (rubrique « Idées ») ─────────
  // jours : jours où ça a lieu ; du / au (facultatif) : période de l'année.
  // Vérifier les horaires auprès de la mairie avant de les afficher.
  evenements: [
    { titre: 'Marché aux fleurs', titre_en: 'Flower market', lieu: 'Cours Saleya, Vieux-Nice',
      jours: ['mar', 'mer', 'jeu', 'ven', 'sam', 'dim'], horaires: 'Le matin', horaires_en: 'Mornings',
      texte: 'Fleurs, fruits et spécialités niçoises, au cœur du Vieux-Nice.', texte_en: 'Flowers, fruit and Niçoise specialities in the heart of Old Nice.' },
    { titre: 'Brocante du lundi', titre_en: 'Monday flea market', lieu: 'Cours Saleya, Vieux-Nice',
      jours: ['lun'], horaires: 'Toute la journée', horaires_en: 'All day',
      texte: 'Antiquités, vinyles et objets chinés : le grand rendez-vous des curieux.', texte_en: 'Antiques, vinyl and vintage finds: a treasure hunt by the sea.' },
  ],

  // ─── Guides « idées de journée » ──────────────────────────────────────────
  // Chaque étape peut citer une adresse partenaire (commercant: 'c5') : elle
  // s'affiche alors avec sa photo et ouvre sa fiche. Bel emplacement à vendre.
  guides: [
    { id: 'journee', photo: 'https://images.unsplash.com/photo-1729710429542-ef3b7e2ebde1',
      titre: 'Une journée parfaite à Nice', titre_en: 'A perfect day in Nice',
      accroche: 'Du marché aux fleurs au coucher de soleil sur la Baie des Anges.',
      accroche_en: 'From the flower market to sunset over the Baie des Anges.',
      etapes: [
        { heure: '9h', heure_en: '9 am', commercant: 'c5', titre: 'Café au marché aux fleurs', titre_en: 'Coffee at the flower market',
          texte: 'Le Cours Saleya s’éveille : fleurs, fruits, socca. Un café en terrasse pour commencer.',
          texte_en: 'Cours Saleya wakes up: flowers, fruit, socca. Start with a coffee on a terrace.' },
        { heure: '10h30', heure_en: '10.30 am', titre: 'La Colline du Château', titre_en: 'Castle Hill',
          texte: 'Montez à pied (15 min) ou par l’ascenseur gratuit : la plus belle vue sur la baie.',
          texte_en: 'Walk up (15 min) or take the free lift: the best view over the bay.' },
        { heure: '12h30', heure_en: '12.30 pm', commercant: 'c6', titre: 'Déjeuner les pieds dans l’eau', titre_en: 'Lunch by the water',
          texte: 'Transats, poisson grillé et rosé bien frais sur la Promenade.',
          texte_en: 'Sunbeds, grilled fish and chilled rosé on the Promenade.' },
        { heure: '15h', heure_en: '3 pm', titre: 'Flâner dans le Vieux-Nice', titre_en: 'Wander through Old Nice',
          texte: 'Ruelles colorées, cathédrale Sainte-Réparate et une glace pour la route.',
          texte_en: 'Colourful lanes, Sainte-Réparate cathedral and an ice cream for the road.' },
        { heure: '18h', heure_en: '6 pm', commercant: 'c4', titre: 'Cocktail au coucher du soleil', titre_en: 'Sunset cocktail',
          texte: 'La baie devient rose et or : le meilleur moment de la journée.',
          texte_en: 'The bay turns pink and gold: the best moment of the day.' },
        { heure: '20h30', heure_en: '8.30 pm', commercant: 'c1', titre: 'Dîner sur le port', titre_en: 'Dinner at the harbour',
          texte: 'Poisson du jour en terrasse, face aux bateaux illuminés.',
          texte_en: 'Catch of the day on a terrace, facing the lit-up boats.' },
      ] },
    { id: 'amoureux', pour: ['couple'], photo: 'https://images.unsplash.com/photo-1470337458703-46ad1756a187',
      titre: 'Nice en amoureux', titre_en: 'Nice for two',
      accroche: 'Criques secrètes, village perché et dîner aux chandelles.',
      accroche_en: 'Hidden coves, a hilltop village and a candlelit dinner.',
      etapes: [
        { heure: 'Matin', heure_en: 'Morning', commercant: 'c7', titre: 'Les criques en duo', titre_en: 'Coves for two',
          texte: 'Baptême de plongée ou simple randonnée palmée dans l’eau turquoise.',
          texte_en: 'A first dive or a simple snorkel in turquoise water.' },
        { heure: 'Midi', heure_en: 'Noon', commercant: 'c2', titre: 'Socca à partager', titre_en: 'Socca to share',
          texte: 'La spécialité niçoise, chaude et croustillante, à deux sur un coin de table.',
          texte_en: 'Nice’s speciality, hot and crispy, shared at a little table.' },
        { heure: 'Après-midi', heure_en: 'Afternoon', commercant: 'c8', titre: 'Escapade à Èze', titre_en: 'Escape to Èze',
          texte: 'Village perché au-dessus de la mer, jardins exotiques et ruelles de pierre.',
          texte_en: 'A village perched above the sea, exotic gardens and stone lanes.' },
        { heure: 'Soir', heure_en: 'Evening', commercant: 'c4', titre: 'Un verre face à la baie', titre_en: 'A drink facing the bay',
          texte: 'Deux cocktails, le soleil qui plonge dans la mer.',
          texte_en: 'Two cocktails as the sun sinks into the sea.' },
        { heure: 'Nuit', heure_en: 'Night', commercant: 'c9', titre: 'Rentrer sans souci', titre_en: 'Get home easily',
          texte: 'Un chauffeur privé vous ramène au logement.',
          texte_en: 'A private driver takes you back to the apartment.' },
      ] },
  ],
};
