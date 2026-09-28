# Landing page — Hôtel à Nice, séjours d'hiver au mois

Page React + Tailwind CSS pour trouver des locataires de longue durée
(étudiants, saisonniers, nomades) d'octobre à mars. Pas de paiement : la page
récolte des demandes de contact.

## Lancer la page sur son ordinateur

```bash
cd hotel-nice
npm install
npm run dev      # ouvre http://localhost:5173
```

## Mettre en ligne

`npm run build` crée un dossier `dist/` prêt à publier (Vercel, Netlify…).
Sur Vercel : nouveau projet → « Root Directory » = `hotel-nice` → Deploy.

## Ce qu'il faut personnaliser (tout est dans `src/config.js`)

- **Nom, slogan, téléphone, e-mail, adresse** de l'hôtel.
- **Photos** : déposez-les dans `public/images/` (voir `LISEZ-MOI.txt`).
  Tant qu'une photo manque, un fond coloré s'affiche à la place.
- **Réception des demandes** : créez un formulaire gratuit sur
  https://formspree.io et collez son adresse dans `FORM_ENDPOINT`.
  Sans ça, la page est en mode démo (le message de succès s'affiche mais rien
  n'est envoyé).

## Organisation du code

```
src/
  config.js                 réglages (textes, photos, envoi du formulaire)
  index.css                 couleurs et polices (sable, crème, bleu nuit, vert forêt)
  App.jsx                   ordre des sections
  components/
    Header.jsx              logo + bouton « Réserver mon séjour » toujours visible
    Hero.jsx                grand titre + bandeau de réassurance
    Bento.jsx               grille photos (réception, chambres, services inclus)
    RoomCarousel.jsx        carrousel des chambres avec badges
    Audience.jsx            « Pour qui ? » (3 profils)
    ContactForm.jsx         formulaire + écran de confirmation
    Faq.jsx                 questions fréquentes en accordéon
    Footer.jsx, MobileCta.jsx, Photo.jsx
```
