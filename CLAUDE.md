# Instructions du dépôt

## Style de communication

Toujours expliquer les choses simplement, comme si le propriétaire était un adolescent qui n'y connaît rien en technique. Pas de jargon, pas de termes complexes — des phrases courtes, concrètes, qui vont droit au but. Cette règle s'applique à toutes les réponses, synthèses et résumés, sur l'ensemble du projet Loc'Air (site, app admin, app transporteur).

## Déploiement

Quand une pull request de correctifs/améliorations est prête sur la branche de
travail (checks verts, pas de conflit), la merger vers `main` directement,
sans demander confirmation au préalable — le propriétaire a validé ce mode de
fonctionnement. `main` est la branche déployée en production (Vercel).

## Migrations SQL

Cette session n'a aucun accès à la base Supabase de production (pas
d'identifiants) — un changement de schéma (nouvelle colonne/table dans
`supabase/schema.sql` ou `supabase/migration_2026-07-09.sql`) ne prend jamais
effet tout seul en prod, même après merge et déploiement du code. Le code déjà
vécu ça en cassant Réservations/Livraisons (colonne `reservations.masquee`
utilisée par le code déployé mais absente de la vraie base).

Donc : avant de merger une PR qui touche au schéma, prévenir explicitement le
propriétaire et lui donner le SQL exact à coller dans Supabase → SQL Editor.
Ne jamais supposer que la migration a été appliquée juste parce que le code
est en prod.

## Offre B2B (Loc'Air Pro)

Une seule offre pro, pour **tous les appareils** loués par Loc'Air.
Sources de vérité : `pro.html` (rafraîchisseur), `api/_lib/pricing.js`
(barèmes), `api/_lib/julieKnowledge.js` (PortaSplit). Si un chiffre change,
le changer partout. Ne jamais inventer un prix, un délai ou une promesse
qui n'est pas écrit ici.

### Les appareils et leur prix pro

**1. Rafraîchisseur d'air (adiabatique)** — le produit phare des pros.
Prix déjà spécial pro, hors taxes, par appareil et par jour :

| Jours de location | Prix par jour |
|---|---|
| Jours 1 à 7 | 40 € |
| Jours 8 à 14 | 34 € |
| Jours 15 à 21 | 30 € |
| À partir du 22e jour | 27 € |

- Seuls les jours **en plus** passent au prix suivant. Exemple : 10 jours
  = 7 × 40 + 3 × 34 = 382 € HT par appareil.
- **Forfait de 120 € HT, une seule fois**, quel que soit le nombre
  d'appareils : livraison, installation, mise en route, reprise.
- Location possible dès **1 jour** (événements).
- Exemple du site : 1 appareil, 7 jours = 280 € + 120 € = **400 € HT**.
- Pas de remise quantité en plus : ce prix est déjà un prix pro.

**2. Climatiseur mobile** — bureaux, salles de réunion, chambres d'hôtel,
Airbnb gérés par une conciergerie.
- Prix de base : 12 €/jour (jours 1 à 7), 10 € (8 à 14), 9 € (15 à 21),
  8 € (dès le 22e). Minimum 7 jours.
- Livraison et installation : 60 €.

**3. PortaSplit réversible** (chaud l'hiver, froid l'été) — locaux
occupés toute l'année, logements meublés.
- Sans engagement : 29 €/jour, dès 7 jours, livraison 30 €.
- Abonnement 6 mois : 99 €/mois + 229 € à la souscription
  (installation offerte).

**Épurateurs d'air : plus proposés.** Retirés du site (accueil, menus,
pied de page) et de Julie. Ne plus les citer nulle part.

### Remise pro selon la quantité (climatiseur et PortaSplit)

Comptée sur le nombre d'appareils d'**une même commande** :

| Appareils | Remise sur le prix de location |
|---|---|
| 1 ou 2 | aucune |
| 3 à 4 | −10 % |
| 5 à 9 | −15 % |
| 10 et plus | −20 % |

- La remise s'applique au prix par jour ou par mois. Elle ne touche pas
  la livraison ni les 229 € de souscription du PortaSplit.
- **Livraison comptée une seule fois** pour toute la commande, pas une
  fois par appareil.
- Le rafraîchisseur n'est pas concerné (il a déjà son prix pro).
- **Réservée aux entreprises** : bouton « Professionnel » + **SIRET
  valide** (le site vérifie le numéro). Sans SIRET valide, prix normal.
- **Climatiseur : programmée sur le site** (`reserver.html` pour le total
  affiché, `api/checkout.js` pour le montant payé, barème dans
  `api/_lib/pricing.js` → `remiseQuantitePct`). Les trois doivent rester
  identiques. En ligne, on peut prendre 5 appareils au maximum ; 10 et
  plus passe par un devis.
- **PortaSplit : sur devis** (téléphone ou WhatsApp). Le paiement en ligne
  du PortaSplit ne gère qu'un appareil à la fois.
- La remise s'ajoute à un éventuel code promo (le code est calculé sur le
  prix avant remise, côté site comme côté serveur).
- Sur la facture, la remise apparaît dans la ligne « Remise commerciale ».

### Ce que tout client pro a, quel que soit l'appareil

- Aucune caution.
- Panne : appareil remplacé le jour même.
- Assistance 7j/7 de 8h à 20h.
- Facture au nom de la société, avec la TVA, paiement par virement.
- Rappel : cocher « Professionnel » dans le tunnel des particuliers sert
  juste à avoir une facture au nom de la société. Ça ne change pas le prix.

### Délai de livraison

- Après une demande : **on confirme par téléphone dans l'heure**, 7j/7 de
  8h à 20h.
- Commande **avant 20h → livré le lendemain**, sinon le surlendemain.
- Option **Express 2h** (jour même, commande avant 18h, +60 €) : prévue
  pour les particuliers. Pour un pro, ne pas la promettre par écrit sans
  l'accord du propriétaire (surtout pour plusieurs appareils).
- Au-delà de 5 appareils : appel obligatoire pour vérifier le stock avant
  de promettre une date.
- Rafraîchisseur : l'eau (réservoir ou raccordement) se règle **pendant
  la visite**, pas après la livraison.

### Les 4 angles d'attaque

Chaque angle = un type de client + son problème + l'appareil qui le règle.
Toujours partir du problème, pas de la machine.

1. **Commerces — « la porte reste ouverte »**
   Une boutique qui ferme sa porte perd ses clients. Un climatiseur ne
   marche que porte fermée → **rafraîchisseur** pour la surface de vente.
   La réserve ou le bureau du fond, fermés → **climatiseur mobile**.

2. **Restaurants, hôtels et conciergeries — « le client ne doit pas avoir chaud »**
   Terrasse et cuisine sans fenêtre → **rafraîchisseur**. Chambres
   d'hôtel et logements Airbnb → **climatiseur mobile** pour l'été,
   **PortaSplit** s'ils sont loués toute l'année (il chauffe aussi
   l'hiver). Gros volume d'appareils = la remise quantité joue à fond.

3. **Bureaux, entrepôts et ateliers — « les équipes n'en peuvent plus »**
   Hangar ou atelier trop grand pour être climatisé → **rafraîchisseur**
   sur les postes de travail. Bureaux et salles de réunion fermés →
   **climatiseur mobile** ou **PortaSplit**. Argument : la santé et le
   travail des équipes pendant les fortes chaleurs.

4. **Événements — « l'électricité ne suit pas »**
   Chapiteau, salon, mariage, tournage : plusieurs climatiseurs font
   sauter le tableau, et le groupe électrogène coûte plus cher que le
   froid → **rafraîchisseur**, une prise ordinaire suffit. Location dès
   1 jour, montée et démontée par nos soins.

### Ce qu'on dit toujours honnêtement (les limites)

- Rafraîchisseur : il faut que l'air circule (porte, fenêtre ou
  extraction). Plus l'air est humide, moins il refroidit. Ce n'est pas un
  climatiseur : on le dit avant la signature.
- Climatiseur mobile : il ne marche que dans une pièce fermée, et
  jusqu'à environ 15 m² par appareil.
- PortaSplit : jusqu'à environ 42 m² par appareil.
