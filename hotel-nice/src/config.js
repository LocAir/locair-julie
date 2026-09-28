/**
 * Réglages de la page — tout ce qu'il faut modifier est ici.
 *
 * PHOTOS : déposez vos fichiers dans `public/images/` avec ces noms
 * (reception.jpg, chambre-1.jpg…). Tant qu'un fichier manque, la page
 * affiche un joli fond de couleur à la place : rien ne casse.
 */
export const HOTEL = {
  nom: "L'Hôtel Azur",
  slogan: 'Votre cocon tout inclus à Nice cet hiver.',
  telephone: '+33 4 93 00 00 00',
  email: 'contact@hotel-azur-nice.fr',
  adresse: 'Promenade des Anglais, 06000 Nice',
}

export const IMAGES = {
  reception: {
    src: '/images/reception.jpg',
    alt: "La réception de l'hôtel, lumineuse et accueillante",
  },
  chambres: [
    { src: '/images/chambre-1.jpg', alt: 'Chambre avec grand lit et linge frais', legende: 'Un grand lit, du linge frais chaque semaine' },
    { src: '/images/chambre-2.jpg', alt: 'Coin bureau près de la fenêtre', legende: 'Un vrai bureau pour travailler ou réviser' },
    { src: '/images/chambre-3.jpg', alt: 'Salle de bain privative', legende: 'Salle de bain privative, serviettes fournies' },
  ],
  services: {
    src: '/images/services.jpg',
    alt: 'Petit-déjeuner servi sur une terrasse ensoleillée',
  },
}

/**
 * FORMULAIRE : collez ici l'adresse d'un service comme Formspree
 * (https://formspree.io/f/xxxx) pour recevoir les demandes par e-mail.
 * Laissé vide = mode démo (la page affiche le message de succès sans rien envoyer).
 */
export const FORM_ENDPOINT = ''
