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

Source de vérité : la page `pro.html` (adresse `/pro`). Si un chiffre change,
le changer **aux deux endroits** : ici et dans `pro.html` (texte + calculateur).
Ne jamais inventer un prix, un délai ou une promesse qui n'est pas écrit ici.

### Ce qu'on vend aux pros

La location de **rafraîchisseurs d'air** (adiabatiques : de l'eau qui
s'évapore, pas de gaz, pas de gaine, une prise normale suffit). On livre,
on installe, on reprend. Pour un bureau fermé, une salle de réunion ou une
chambre d'hôtel, ce n'est pas le bon appareil : on propose un climatiseur.

### Tarifs dégressifs pro (hors taxes, par appareil et par jour)

| Jours de location | Prix par jour |
|---|---|
| Jours 1 à 7 | 40 € |
| Jours 8 à 14 | 34 € |
| Jours 15 à 21 | 30 € |
| À partir du 22e jour | 27 € |

- Seuls les jours **en plus** passent au prix suivant (les 7 premiers jours
  restent à 40 €, même pour un mois). Exemple : 10 jours = 7 × 40 + 3 × 34
  = 382 € HT par appareil.
- **Forfait de 120 € HT, une seule fois**, quel que soit le nombre
  d'appareils : livraison, installation par le technicien, mise en route
  devant l'équipe, reprise à la fin.
- Exemple affiché sur le site : 1 appareil, 7 jours = 280 € + 120 € = **400 € HT**.
- Le calculateur en ligne va jusqu'à **5 appareils**. Au-delà : appel
  téléphonique, devis au cas par cas.
- Inclus : aucune caution, panne remplacée le jour même, assistance 7j/7
  de 8h à 20h, facture avec TVA, paiement par virement.

### Délai de livraison

- Après la demande sur le site : **on confirme la disponibilité par
  téléphone dans l'heure**, 7j/7 de 8h à 20h.
- Livraison standard : commande **avant 20h → livré le lendemain**, sinon
  le surlendemain (même règle que le reste du site).
- Option **Express 2h** (jour même, commande avant 18h, +60 €) : prévue
  pour les particuliers. Pour un pro, ne pas la promettre par écrit sans
  l'accord du propriétaire (installation + volume d'appareils).
- L'eau (réservoir ou raccordement) se règle **pendant la visite**, pas
  après la livraison.

### Les 4 angles d'attaque

Chaque angle = un type de client + le problème qu'un climatiseur ne
règle pas. Toujours partir du problème, pas de la machine.

1. **Magasins — « la porte reste ouverte »**
   Une boutique qui ferme sa porte perd ses clients, et un climatiseur ne
   marche que porte fermée. Le rafraîchisseur tient la surface de vente
   porte ouverte, toute la journée.

2. **Restaurants et terrasses — « il n'y a pas de fenêtre »**
   Terrasse en plein soleil, cuisine à 40° : nulle part où passer une
   gaine. On rafraîchit les clients en terrasse et l'équipe en cuisine.

3. **Entrepôts et ateliers — « le volume est trop grand »**
   Personne ne climatise un hangar. On ne rafraîchit pas le bâtiment, on
   rafraîchit les postes de travail. Argument fort : santé et rendement
   des équipes pendant les fortes chaleurs.

4. **Événements — « l'électricité ne suit pas »**
   Chapiteau, salon, mariage, tournage : plusieurs climatiseurs font
   sauter le tableau, et le groupe électrogène coûte plus cher que le
   froid. Une prise ordinaire suffit. Location courte, montée et démontée
   par nos soins.

### Ce qu'on dit toujours honnêtement (les limites)

- Il faut de l'air qui se renouvelle (une porte, une fenêtre ou une
  extraction). Dans un local fermé, ça ne marche plus.
- Plus l'air est humide, moins ça refroidit. Au bord de la mer, par temps
  très humide, on conseille parfois un appareil de plus.
- Ce n'est pas un climatiseur : on le dit avant la signature, pas au
  premier jour de canicule.
