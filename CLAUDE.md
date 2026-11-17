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
  pour les particuliers. Pour un pro, elle peut être proposée **seulement
  dans la verticale A** (conciergeries, voir « Prospection par sprints »),
  pour 1 ou 2 climatiseurs, aux mêmes conditions. Ailleurs, ou pour plus
  d'appareils, ne pas la promettre par écrit sans l'accord du propriétaire.
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

## Prospection par sprints (4 verticales)

On ne prospecte **jamais toutes les cibles en même temps**. On travaille
une verticale à la fois, en « sprint » : une liste, un message, un suivi,
puis un bilan avant de passer à la suivante. Chaque verticale a son
objectif, son produit et ses règles ci-dessous. Elles s'ajoutent à
l'offre B2B au-dessus : aucun prix, délai ou promesse en dehors de ce qui
y est écrit.

### Règles communes à tous les sprints

- **Une verticale par sprint.** Un sprint = 20 à 30 cibles maximum, tirées
  du même fichier, du même type. Ne jamais mélanger deux verticales dans
  un même envoi ni un même fichier de suivi.
- **Ordre conseillé :** A → B → C → D. Ne lancer le sprint suivant
  qu'après le bilan du précédent (combien de réponses, de rendez-vous, de
  commandes).
- **Les listes de prospects ne vont jamais dans ce dépôt.** Tout ce qui
  est dans le dépôt est publié sur Vercel, donc lisible par n'importe qui
  sur locair.fr. Les listes restent dans des fichiers à part (CSV
  envoyés au propriétaire).
- **Sources autorisées :** annuaire officiel des entreprises
  (recherche-entreprises.api.gouv.fr), sites web des entreprises,
  Pages Jaunes. Pas d'aspiration automatique de Google Maps (interdite par
  Google).
- **Rien d'inventé :** une coordonnée non trouvée reste vide. Un numéro
  douteux (autre ville, autre SIRET) est marqué « à vérifier » dans la
  colonne Notes.
- **Emails de prospection (règle CNIL pour les entreprises) :** le message
  doit parler du métier de la personne, dire qui écrit (Loc'Air,
  téléphone 06 63 79 87 56) et contenir un moyen simple de ne plus rien
  recevoir. Quelqu'un qui dit stop n'est plus jamais recontacté.
- **Un message = un problème + une solution + une seule action** (appeler,
  répondre, réserver). Partir du problème du client, jamais de la
  machine. Phrases courtes, pas de jargon.
- **Suivi :** au plus 2 relances, espacées d'au moins 5 jours. Noter
  chaque contact dans la colonne Notes (date, canal, réponse).
- **Colonnes du fichier de suivi :** type, nom, ville, téléphone, email,
  site, statut (à contacter / contacté / relancé / intéressé / client /
  pas intéressé / stop), date du dernier contact, notes.

### Verticale A — Conciergeries & gestionnaires Airbnb

- **Objectif :** devenir leur **partenaire d'urgence**. Quand un
  voyageur a trop chaud, la conciergerie nous appelle et on livre vite,
  avant que le voyageur laisse un mauvais avis.
- **Le problème à nommer :** un logement sans clim en pleine chaleur =
  un mauvais avis = moins de réservations. Ce n'est pas l'appareil qu'ils
  achètent, c'est leur note.
- **Produits :** climatiseur mobile (urgence, été). PortaSplit pour les
  logements loués toute l'année (il chauffe aussi l'hiver).
- **Ce qu'on peut promettre :** Express 2h le jour même si commande avant
  18h (+60 €), pour 1 ou 2 climatiseurs. Sinon, livré le lendemain si
  commande avant 20h. Remise quantité dès 3 appareils (SIRET valide).
  Panne remplacée le jour même. Aucune caution.
- **Ce qu'on ne promet pas :** une livraison en 2h garantie à toute
  heure, une réserve d'appareils bloquée pour eux, un prix spécial non
  écrit dans l'offre B2B.
- **Action demandée :** enregistrer notre numéro comme « dépannage clim »
  et nous appeler à la prochaine urgence. Bonus : équiper d'avance leurs
  logements les plus exposés (dernier étage, plein sud).
- **Fichier :** lignes « Conciergerie » de la liste des Alpes-Maritimes.

### Verticale B — Installateurs de clim fixe & frigoristes

- **Objectif :** qu'ils nous recommandent à leurs clients qui attendent
  un chantier. Entre le devis et la pose d'une clim fixe, il peut se
  passer des semaines ; pendant ce temps, leur client a chaud.
- **Le problème à nommer :** un client qui attend s'impatiente, et
  risque d'aller voir un concurrent plus rapide. Un appareil en attendant
  le garde patient.
- **Produits :** climatiseur mobile (attente courte), PortaSplit (attente
  longue ou chantier repoussé).
- **Ce n'est pas un concurrent :** on ne vend pas de clim fixe. On loue
  le temps que leur chantier se fasse. Le dire clairement dès la première
  phrase.
- **Ce qu'on peut promettre :** livré le lendemain si commande avant
  20h, reprise à la fin de la location, aucune caution, remise quantité
  dès 3 appareils (SIRET valide) si l'installateur commande lui-même.
- **Qui paie (décidé par le propriétaire) :** le **client final** paie sa
  location au prix normal. L'installateur ne paie rien : il devient
  **apporteur d'affaires** et touche une **commission** sur chaque client
  qu'il nous envoie.
- **Comment ça marche (déjà en place sur le site) :** on crée
  l'installateur comme partenaire dans l'admin (onglet Partenaires). Il
  reçoit un lien personnel (`locair.fr/?p=SONCODE`) et un QR code. Quand
  son client réserve par ce lien, la commission est comptée toute seule,
  et l'installateur la suit dans son espace `locair.fr/partenaire`.
- **Montant :** un pourcentage du montant payé par le client, réglé
  partenaire par partenaire dans l'admin (10 % par défaut). Ne jamais
  écrire un autre taux dans un message sans l'accord du propriétaire.
- **Limite à connaître :** la commission automatique marche pour les
  climatiseurs réservés en ligne. Pour un PortaSplit, ou une commande
  passée par téléphone, la commission se note à la main.
- **Ne jamais dire « gratuit » :** l'appareil n'est pas offert, c'est le
  client qui le loue.
- **Action demandée :** accepter de devenir partenaire, puis donner son
  lien ou son QR code à ses clients qui attendent un chantier.
- **Fichier :** lignes « Frigoriste / climaticien » de la liste des
  Alpes-Maritimes.

### Verticale C — Syndics & agences de gestion locative

- **Objectif :** être la **solution temporaire** qu'ils proposent quand la
  clim d'un locataire tombe en panne, le temps de la réparation.
- **Le problème à nommer :** un locataire sans clim en été appelle
  l'agence tous les jours. La réparation prend du temps (pièce à
  commander, technicien débordé). On calme la situation dès le lendemain.
- **Produits :** climatiseur mobile (réparation courte), PortaSplit
  (réparation longue, ou logement sans clim toute l'année).
- **Ce qu'on peut promettre :** livré le lendemain si commande avant 20h,
  installation sans travaux ni perçage (rien à demander à la copropriété),
  reprise à la fin, aucune caution.
- **Qui paie (décidé par le propriétaire) :** le **locataire**. Il
  réserve et paie lui-même, au prix normal, comme un particulier.
  L'agence ne paie rien et ne s'engage à rien : elle donne juste notre
  numéro ou notre lien. Ne jamais dire au syndic que la location est
  à sa charge ou à celle du propriétaire du logement.
- **Action demandée :** nous ajouter à leur liste de dépanneurs et donner
  notre numéro au locataire en cas de panne.
- **Fichier :** à construire (annuaire officiel, activités « administration
  d'immeubles » et « agences immobilières » dans les Alpes-Maritimes).

### Verticale D — Campings, résidences de tourisme & événementiel

- **Objectif :** du **volume** sur les week-ends chargés et les vagues de
  chaleur (plusieurs appareils d'un coup, sur quelques jours).
- **Le problème à nommer :** pendant une canicule, les clients se
  plaignent, partent plus tôt ou annulent. Pour un événement, la chaleur
  gâche la journée et l'électricité ne suit pas avec des climatiseurs.
- **Produits :** rafraîchisseur (espaces ouverts, accueil, salle, chapiteau,
  dès 1 jour, forfait 120 € HT une seule fois). Climatiseur mobile pour
  les mobil-homes, chambres et bungalows fermés (remise quantité).
- **Ce qu'on peut promettre :** les prix et délais de l'offre B2B, rien
  de plus. **Au-delà de 5 appareils, appel obligatoire** pour vérifier le
  stock avant de promettre une date. Pendant une vague de chaleur, ne
  jamais promettre une disponibilité sans avoir vérifié le stock.
- **Le bon moment :** contacter **avant** la saison (printemps) et avant
  les dates d'événements, pas pendant la canicule, quand le stock est déjà
  pris.
- **Action demandée :** réserver à l'avance les dates chargées, ou
  demander un devis pour l'été.
- **Fichier :** à construire (campings, résidences de tourisme, organisateurs
  d'événements et salles de réception des Alpes-Maritimes).

