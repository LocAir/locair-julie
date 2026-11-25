# Instructions du dépôt

## Style de communication

Toujours expliquer les choses simplement, comme si le propriétaire était un adolescent qui n'y connaît rien en technique. Pas de jargon, pas de termes complexes — des phrases courtes, concrètes, qui vont droit au but. Cette règle s'applique à toutes les réponses, synthèses et résumés, sur l'ensemble du projet Loc'Air (site, app admin, app transporteur).

## Les documents Loc'Air = la ligne directrice (décidé le 24/11/2026)

La convention de partenariat (V11), le playbook Cellule 1 (V3), la to-do
list Cellule 1 et la présentation investisseurs & partenaires (V2) sont la
référence pour tout ce qu'on construit. Ce qui y est écrit et qui manque
au site, à l'admin, à l'espace partenaire ou aux emails est à créer, sans
attendre une demande précise (le propriétaire l'a demandé le 24/11/2026).
Une décision du propriétaire écrite dans ce fichier passe avant un
document (ex. vol/casse payés par Loc'Air, livraison à domicile gardée).

## L'ADN de Loc'Air : simplicité et clarté

Tout ce qu'on fabrique (site, emails, flyers, présentations, écrans du
commerçant et du client) suit la même règle :

- **Le moins de mots possible.** Une idée par bloc, une phrase courte par
  idée. Si une image ou une couleur peut remplacer un texte, on la prend.
- **Un écran = une action.** Le client ou le commerçant sait tout de suite
  quoi faire.
- **Des repères visuels constants** : au comptoir, vert ✓ = retrait,
  bleu ↩ = retour, orange ⇄ = échange. Partout pareil.
- **Pas d'information inutile.** Ce qui n'aide pas à agir tout de suite
  disparaît (dates, rappels, explications déjà connues).
- Avant de livrer, se demander : « Qu'est-ce que je peux enlever ? »

## Style commun (typographie, couleurs) — celui de la page Click & Collect

Décidé le 21/11/2026 : tout le système Loc'Air a le style de
`click-and-collect.html`. Une seule police : **DM Sans** (titres en 900,
jamais de police à empattements : ni Playfair, ni Cormorant, ni Georgia).
Bleu d'action `#1A5EDB` (foncé `#0D3FA0`, clair `#EFF4FD`), encre
`#0E1726`, gris `#4B5873`, fond `#F4F7FC`, boutons en pilule. Logo :
« Loc<em>’Air</em> » en DM Sans 900, « ’Air » en italique, bleu sur fond
clair, blanc sur photo. Pas d'orange, pas d'or.

- **Où ça vit :** `cc-theme.css` (à charger EN DERNIER : il redéfinit les
  couleurs et la police des pages qui ont leurs propres noms de variables),
  `atelier.css` / `locair-design.css` / `menu.css` (pages villes, blog,
  légales), `api/_lib/emailTemplates.js` (emails clients).
- **Ne jamais réécrire un fichier `.css` existant sans l'avoir lu** :
  `locair.css` est la grosse feuille de style de l'accueil et des pages
  villes, pas un fichier de jetons.
- Tout nouvel écran (client, commerçant, partenaire, email) suit ce style.

## Présentation commerçants (book vendeur) — toujours synchronisée

La présentation pour signer les commerçants points de retrait :
https://claude.ai/artifact/SznzrctwqcdPXHqjGns7fj (diaporama).

**À chaque changement du parcours Click & Collect** (écrans de `retrait.html`,
flyer `admin/flyers-commercants.html`, affiche `affiche-retrait.html`,
espace partenaire, prix, commission, virement, règles de retrait/retour),
mettre à jour la présentation dans la même session : refaire les captures
concernées (vrais écrans, client d'exemple) et corriger le texte des diapos.
Le propriétaire l'a demandé le 21/11/2026 : le site et la présentation
disent toujours la même chose.

Structure (24/11/2026, « démonstration du fonctionnement », 8 diapos) :
mission → 1 · Le client réserve (le site) → 2 · Au comptoir (retrait :
écran vert + pièce d'identité ; retour : code commerçant) → 3 · Ce que vous
recevez (affiche QR, flyer, climatiseurs, espace partenaire) → 4 · Ce que
vous gagnez (20 %) → 5 · L'essentiel (6 règles de la convention) → **la
démo (test du QR code) → puis la signature** (« On signe ensemble ? », en
dernier). **Signature** (changé le 25/11/2026 par le propriétaire) : jamais
sur place ; le commerçant reçoit la présentation + la convention par e-mail
et signe chez lui, en ligne, du doigt (voir « Prospection terrain des points
de retrait ») ; le papier en 2 exemplaires reste possible
(admin → Terrain → « Signé sur papier ») ; prévoir SIRET, RIB, horaires.
La page `/contrat-point-retrait` reste une simple demande de rappel. Les autres diapos restent dans les
fichiers, hors de l'ordre. La diapo démo fait scanner `locair.fr/retrait?p=test-locair` :
le numéro **0000** sur ce point lance un mode démo dans le téléphone
(`retrait.html`, fonction `demo`), rien n'est envoyé ni enregistré.

Version à envoyer par email (22/11/2026), à tenir à jour en même temps :
https://claude.ai/artifact/JLju4FoAqkFuP36kpFTi1M — mêmes 4 parties, diapos qui se lisent
seules (liens cliquables, aucune note interne), envoyée en PDF.

## Déploiement

Quand une pull request de correctifs/améliorations est prête sur la branche de
travail (checks verts, pas de conflit), la merger vers `main` directement,
sans demander confirmation au préalable — le propriétaire a validé ce mode de
fonctionnement. `main` est la branche déployée en production (Vercel).

## Migrations SQL

**Depuis le 25/11/2026, l'agent est relié à la base Supabase** (connecteur
Supabase, projet « LocAir's Project », id `ynnohdfxitfimzmolion`). Le
propriétaire l'a demandé : **ne plus lui demander de coller du SQL**.

Un changement de schéma (nouvelle colonne/table) ne prend jamais effet tout
seul en prod, même après merge et déploiement du code. Le code a déjà vécu ça
en cassant Réservations/Livraisons (colonne `reservations.masquee` utilisée
par le code déployé mais absente de la vraie base).

Donc, pour chaque PR qui touche au schéma :
1. Écrire le fichier `supabase/migration_AAAA-MM-JJ_<sujet>.sql` et mettre à
   jour `supabase/schema.sql` (toujours `if not exists`, jamais destructif).
2. **Avant de merger**, appliquer ce SQL soi-même avec `apply_migration`,
   puis vérifier (liste des tables / colonnes) qu'il est bien là.
3. Dire au propriétaire, en une ligne, que la base est à jour.
- Rien de destructif (suppression de table, de colonne ou de données) sans
  son accord écrit.
- Si le connecteur ne répond pas : revenir à l'ancienne méthode (lui donner
  le SQL exact à coller dans Supabase → SQL Editor).
- Vérifié le 25/11/2026 : toutes les tables et colonnes du dépôt existent
  dans la vraie base.

## Offre B2B (Loc'Air Pro)

Une seule offre pro, pour **tous les appareils** loués par Loc'Air.
Sources de vérité : `api/_lib/pricing.js` (barèmes, dont le
rafraîchisseur pro), `api/_lib/julieKnowledge.js` (PortaSplit). Si un chiffre change,
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
  `api/_lib/pricing.js` → `remiseQuantitePct`) et prix proposé dans l'admin
  pour une commande par téléphone (`admin/index.html` → `nrCalcTotal`,
  jusqu'à 20 appareils, −20 % dès 10). Tous doivent rester identiques. En ligne, on peut prendre 5 appareils au maximum ; 10 et
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

## Tarification dynamique (Click & Collect)

Réglages et barrières dans `api/_lib/tarifDynamique.js` (seul endroit où
changer un chiffre). Inspirée de Beyond / PriceLabs.

- **Prix Click & Collect** : location **dès 3 jours** (décidé le 21/11/2026).
  - **3 jours : 99 €** en temps normal, qui est aussi le plus bas ;
    **jamais plus de 119 €**.
  - **7 jours : 150 €** en temps normal (décidé le 19/11/2026), **jamais
    moins de 139 €, jamais plus de 189 €**.
  - 4 à 6 jours : entre les deux. Plus de 7 jours : même proportion du
    barème que les 7 jours.
  - La livraison (`/reserver`) garde son propre barème (7 jours minimum).
- **Signaux** : stock déjà réservé dans la ville (80 % → maximum), chaleur
  prévue sur la période (7 jours, Open-Meteo), dernière minute (seulement
  si la demande est déjà là), période calme (temps frais ET peu de
  réservations → minimum).
- **Barrières, jamais franchies** : jamais sous 99 €/3 jours ni 139 €/7
  jours ; jamais au-dessus de 119 €/3 jours ni 189 €/7 jours ; même prix pour tout le monde au même moment (aucune
  donnée personnelle) ; un signal en panne compte pour rien (prix plus bas,
  jamais plus haut) ; prix affiché garanti 30 min (devis signé) ;
  prolongations jamais majorées.
- **Prolongations (décidé le 21/11/2026)** : barème dégressif gardé : les
  jours ajoutés coûtent la différence entre le prix de la nouvelle durée et
  celui de la durée actuelle (3 → 7 jours = 150 − 99 = 51 €). Un client
  qui avait payé moins que le prix normal garde sa réduction ; jamais plus
  cher que le prix normal (`coefPrixPaye`, `api/_lib/prolongCC.js`).
- **Interrupteur** : variable Vercel `TARIF_DYNAMIQUE=off` → barème seul.
- Toujours dire au client pourquoi le prix monte (« chaleur annoncée »,
  « peu d'appareils restants »), et ne jamais changer les seuils sans
  l'accord du propriétaire.

## Click & Collect — ouvrir un nouveau point de retrait

À rappeler au propriétaire à chaque nouveau commerçant (il l'a demandé le
20/11/2026) :

0. Le commerçant signe la convention **sur papier** (2 exemplaires), en
   rendez-vous, après la démo. Il peut aussi laisser une demande sur
   `locair.fr/contrat-point-retrait` : Loc'Air reçoit un email + une
   notification, l'appelle et passe signer. Entretien des climatiseurs : un passage
   de l'agent tous les 10 jours (convention).
   Décidé le 22/11/2026 : nombre de climatiseurs selon la place du
   commerçant (fixé à la signature) ; fin septembre, Loc'Air reprend les climatiseurs
   (dépose du 10 au 15 mai ; une offre de
   stockage hivernal payée au commerçant est à l'étude : ne pas en
   parler par écrit tant qu'elle n'est pas décidée) ; vol ou casse dans
   la boutique (pas par un client) : Loc'Air paie, **toujours** (« sauf
   faute grave » retiré le 25/11/2026 par le propriétaire) ; un seul point de retrait par quartier (le premier qui
   signe a l'exclusivité) ; saison 2027 de fin mai à fin septembre ;
   parrainage (changé le 22/11/2026) : **50 € au parrain ET 50 € au
   nouveau commerçant**, versés à la main avec le virement qui suit la
   1re location du nouveau point — même règle que la signature ait lieu
   avant ou pendant la saison (décidé le 22/11/2026). Le site compte 20 %
   comme d'habitude. Le lien de parrainage (espace partenaire,
   « Parrainer un commerçant ») : `locair.fr/parrainage?parrain=<commerce>`,
   une demande de rappel très courte (commerce, nom, téléphone) qui
   déclenche le parrainage ; si le commerçant signe, il est activé.
   Présenté au commerçant comme « Développer mes revenus » (espace
   partenaire) : il y voit ses demandes « En attente », « Signé · 50 €
   activé » ou « Pas cette fois ». Admin → Points de retrait → Parrainages :
   boutons « Signé » / « Refusé ». Table `parrainages`
   (`supabase/migration_2026-11-22_parrainages.sql`).
   **Détection automatique** (`api/_lib/parrainage.js`) : quand l'admin
   crée ou active la fiche du commerçant (même téléphone ou même nom de
   commerce qu'une demande en attente), le parrainage passe à « signé »,
   fenêtre « 🎁 Parrainage détecté » + notification admin + email au
   parrain. À la 1re location payée du nouveau point : notification et
   email « À verser » (50 € au parrain et 50 € au nouveau).
   Même commerce parrainé par deux commerçants : **le premier qui a
   parrainé gagne** ; les autres demandes passent à « Pas cette fois ».
1. Ajouter le point dans `api/_lib/pointsRetrait.js` (adresse, horaires,
   `tel` de la boutique, `partenaire_code`, `exemple: false`). Commission
   du commerçant : **20 %** de la location payée (décidé le 21/11/2026).
2. Créer le commerçant dans l'admin (onglet Partenaires) avec son téléphone.
3. Imprimer l'**affiche du comptoir** (QR code client) :
   `locair.fr/affiche-retrait?p=<id>`.
4. Imprimer et **remettre en main propre le demi-flyer commerçant** (A5) :
   son code retour + le QR code de son espace partenaire —
   `locair.fr/admin/flyers-commercants?p=<id>` (connecté à l'admin).
   À garder derrière le comptoir, jamais affiché.
5. Faire un essai complet (retrait puis retour) avec le point.

Page `click-and-collect.html` (22/11/2026) : paiement express Apple Pay /
Google Pay sans formulaire (coordonnées prises dans le téléphone, mention
« En payant, vous acceptez les conditions ») ; carte avec le stock en direct
(`api/points-dispo.js` : vert disponible, orange dernier appareil, gris
complet, pour un retrait demain — jamais le nombre exact) ; « Bonjour
{prénom}, même point qu'avant » pour un client qui revient ; carte chargée
au premier geste (page plus rapide). `/retrait` s'ouvre sans réseau
(`retrait-sw.js`). Apple Pay n'apparaît que si le domaine locair.fr est
validé dans Stripe.

**Convention de partenariat (V11, reçue le 24/11/2026) = référence.**
Contact des commerçants : **partenaires.locair@outlook.com** (pages et emails
partenaires, réponses des emails envoyés aux commerçants ; les notifications
internes restent sur contact@locair.fr). **Envoi depuis Outlook** (décidé
le 25/11/2026 : tout ce qui touche les points de retrait et les partenaires
part de cette boîte) : tout e-mail envoyé avec `replyTo`
partenaires.locair@outlook.com passe par Microsoft Graph
(`api/_lib/outlook.js`, branché dans `sendBrevoEmail`) quand la boîte est
reliée (admin → accueil → Envoi rapide → « Relier Outlook » ; variables
Vercel `MS_CLIENT_ID`, `MS_CLIENT_SECRET` ; table `outlook_connexion`,
`supabase/migration_2026-11-25_outlook.sql`). Sinon, ou si Outlook refuse,
Brevo prend le relais depuis contact@locair.fr : l'e-mail part toujours.
**Changé le 25/11/2026 au soir (accord du propriétaire) :** Microsoft a
bloqué puis bridé la boîte gratuite (e-mails « partis » mais jamais reçus).
Les e-mails partenaires partent donc de **partenaires@locair.fr par Brevo**
(nom « Loc’Air Partenaires », réponses vers partenaires.locair@outlook.com ;
repli contact@locair.fr si Brevo refuse l'adresse). L'envoi par Outlook ne
se fait plus que si la variable Vercel `OUTLOOK_ENVOI=on`.
**Relié et testé le 25/11/2026** (appli Azure « Loc'air site », adresse de
retour exacte `https://locair.fr/api/outlook`, nom d'expéditeur « Loc'Air
Partenaires »). L'agent a aussi accès à Vercel (équipe `loc-air`, projet
`locair-julie`, id `prj_LSmjqEtiKrRx1gXiSorTLXYBpNUv`) : erreurs en ligne,
variables, relance du site.
Nouvel e-mail aux commerçants = toujours avec ce `replyTo`. Dépose des climatiseurs **du 10 au 15 mai 2027**, saison **fin mai → fin
septembre** (≈ 120 jours), stock fixe par point (souvent 3, 4 ou 5, mais
**pas rigide**, décidé le 25/11/2026 : nombre fixé à la signature, de 1 à
20, puis **modifiable à tout moment depuis l'admin avec l'accord du gérant** :
bouton « Stock » de la carte du point, raison obligatoire, historique gardé
(`stock_points`, `stock_points_historique`,
`supabase/migration_2026-11-25_stock_points.sql`, `api/_lib/stockPoints.js` ;
le chiffre de `pointsRetrait.js` n'est que la valeur de départ), e-mail de
confirmation au commerçant. **Appareil en retard** (décidé le 25/11/2026) :
tant qu'il n'est pas rendu, il bloque sa place au point aujourd'hui et
demain (`lignesEnRetard`, `api/_lib/clickCollect.js`). Retour pas validé au
comptoir : bouton **« Débloquer »** (Admin → Points de retrait → À faire et
liste Retards ; gérant seulement, raison obligatoire, gardée sur la
réservation) = appareil noté rendu, place libérée. **Retour sans incident** (décidé le
25/11/2026) : l'appareil reste disponible et peut repartir ; « à
reconditionner » n'est qu'une note pour le passage de l'agent (tous les 7 à
10 jours). **Avec un incident** (panne, casse : reprise ouverte au point),
il bloque sa place jusqu'à la fin de la reprise (`lignesEnPanne`). Contrôle quotidien (« À faire ») : « Stock
dépassé » quand les locations prévues sur 60 jours dépassent le stock d'un
point, « Flotte dépassée » quand les points annoncent plus de climatiseurs
que la flotte de la cellule ; selon
la place, ≈ 40 × 40 cm chacun, sans rotation), rangés sous
**housse bleue unie sans logo**, gaine au-dessus ; retrait et retour **au
même point** ; agent Loc'Air **tous les 10 jours** ; 20 % virés **entre le
1er et le 5 du mois suivant** ; résiliation libre par email ou SMS avec
**7 jours de préavis**. **Retrait : le client montre l'écran vert et sa
pièce d'identité**, que le commerçant regarde seulement (pas de copie, rien
à cocher). **Vol ou casse dans la boutique : Loc'Air paie, sans
exception** (« sauf faute grave » retiré le 25/11/2026 ; décision du propriétaire du 24/11/2026 : l'article 6 de la
convention, qui met ces vols à la charge du commerçant, est à corriger ; la
« mise en service …/2026 » aussi, c'est la saison 2027).

**Playbook Cellule 1 (V3, reçu le 24/11/2026).** Axe Nice–Cannes seulement
(8 à 10 points, 40 climatiseurs, 1 micro-box pour les pannes). Points
d'exemple hors de l'axe retirés (Grasse, Villefranche, Beausoleil, Menton).
La livraison à domicile reste proposée à côté (choix du propriétaire).
Fiche mémo « 3 gestes au comptoir » (espace partenaire + flyer commerçant) :
✓ retrait = écran vert + pièce d'identité regardée ; ↩ retour = appareil,
housse et gaine récupérés → code ; ! un souci (accessoire manquant, abîmé,
sale) → le commerçant reprend l'appareil et prévient tout de suite, avec
une photo (WhatsApp / email partenaires / 06 63 79 87 56). Admin → Points de
retrait → « Remplissage · 7 prochains jours » par ville : 85 % = baisser
la pub, 90 % = pub en pause. Même écran : « Passage fait » sur chaque
point (table `passages_agent`, `supabase/migration_2026-11-24_passages_agent.sql`),
en rouge au-delà de 10 jours ; et « Saison · point mort » : jours-machine
loués depuis le 1er mai face aux 313–369 du playbook (charges 1 465 €/mois :
box 165, agent 700, pub 600). En haut de l'écran : la phase de la saison
(avant dépose / dépose / saison / reprise / hors saison), la micro-box
(40 − climatiseurs déposés dans les vrais points) et **« À faire aujourd'hui »**,
une ligne = une action, la plus urgente en haut : signalements et pannes
ouverts (remplacer avec la micro-box), retards, 20 % à virer (rouge après le
5 du mois), passages agent, pub à baisser, à reconditionner, commerçant non
relié, RIB manquant. Le bloc point mort montre aussi l'occupation de la
saison (jours-machine / 4 800 possibles = 40 × 120 jours).
**Retour anticipé (décidé le 24/11/2026)** : accepté à tout moment au même
point ; les jours non utilisés ne sont **pas remboursés**, sauf panne ou
rétractation dans les 14 jours (CGV 10 ter, FAQ de la page, Julie).
**Cellules (24/11/2026)** : `CELLULES` dans `api/_lib/pointsRetrait.js`
(flotte, charges box/agent/pub, saison, dépose, prix repères, pub/jour) ;
chaque point a un champ `cellule` (`c1` par défaut). Admin → Points de
retrait : une carte par cellule (occupation vs point mort, remplissage
7 jours + consigne pub, nombre de choses à faire, chiffre de la saison et
20 % commerçants, micro-box) ; un clic filtre tout l'écran sur la cellule.
Ouvrir une cellule = une ligne dans `CELLULES` + `cellule: 'c2'` sur ses
points. Point mort calculé : charges × mois ÷ (prix repère × 0,8).
Relevé récapitulatif (convention art. 2) : le 1er du mois, chaque
commerçant reçoit par email son relevé du mois précédent (locations, encaissé,
sa part, date du virement ou RIB manquant) — `runReleveCommercants`
(`api/cron-monthly.js`, lancé par `cron-daily.js`). Transfert à la société
d'exploitation (art. 7) : Admin → Points de retrait → « Transfert à la
société d'exploitation » (aperçu puis envoi email + SMS à chaque commerçant
d'un point ouvert ; propriétaire seulement ; jamais deux fois).
**Saison du Click & Collect (playbook)** : une location doit tenir entre
l'`ouverture` (16 mai) et la `fin_saison` (30 septembre) de la cellule du
point — `horsSaison()` dans `_lib/pointsRetrait.js`, vérifié au prix
(`click-collect-prix`, la page affiche « Hors saison »), au paiement et à la
prolongation. Le point de test est ouvert toute l'année. Écrit aussi dans
les CGV 10 ter et dans Julie.
Page `click-and-collect.html` : si le point choisi est complet aux dates
choisies, bouton « Prendre {point le plus proche libre} · à X km » (cherche
parmi les 3 points ouverts les plus proches, même calcul que le paiement).

### Prospection terrain des points de retrait (25/11/2026)

Demandé par le propriétaire le 25/11/2026. Une visite = 5 gestes :

1. **Accroche + QR code** : le prospecteur ouvre `locair.fr/prospection`
   (son code d'équipe ; rôle **« prospecteur »** = l'appli terrain
   seulement, rien d'autre de l'admin, voir `checkProspecteur` dans
   `api/_lib/auth.js`), choisit sa zone (Nice, Antibes / Juan-les-Pins,
   Cannes) et touche « Nouvelle visite » : QR code de session.
2. **3 · 4 · 5 + e-mail** : le commerçant scanne avec son téléphone
   (`/partenaires?s=…`), lit les règles, choisit **3, 4 ou 5
   climatiseurs** (gros boutons ; « Un autre nombre ? » de 1 à 20 ; stock
   modifiable ensuite dans l'admin), remplit dans l'ordre **commerce**
   (+ son téléphone, facultatif), **prénom, nom, portable du gérant,
   e-mail** (obligatoires ; les deux numéros vont dans la convention,
   colonne `tel_commerce`, `migration_2026-11-25_prospection_tel_commerce.sql`) — le
   téléphone propose de tout remplir d'un toucher (champs `autocomplete`) ;
   en tapant le nom du commerce, l'**annuaire officiel** (recherche-entreprises,
   gratuit, action `entreprises`) propose sa fiche : il **confirme** « Oui,
   c'est exact » (SIRET, adresse, gérant) ou « Non, ce n'est pas moi » ; le
   SIRET confirmé va dans la convention (colonne `siret`) —, touche
   « OK — Recevoir par e-mail ». La présentation + la convention
   pré-remplie partent tout de suite (bouton « Signer en ligne »). Le
   prospecteur le voit tout de suite.
3. **1 photo + GPS** (emplacement prévu, ou devanture) : la fiche
   est créée, sans saisie obligatoire. Pas de « OK » (gérant absent) :
   fiche « À repasser » ; « Saisie rapide » = boutique + tél./e-mail.
4. **Il signe chez lui** (décidé le 25/11/2026 : démarche progressive,
   **on ne parle pas de signature sur place**) : il étudie l'e-mail chez
   lui, puis « Signer en ligne » → `/partenaires?s=…&signer=1` → signature
   du doigt (convention signée en PDF, copie au commerçant et à Loc'Air).
- **Envoi rapide** (accueil de l'admin, demandé le 25/11/2026) : quelqu'un
  rencontré par hasard (rue, téléphone) → e-mail (+ prénom, commerce
  facultatifs) → « Merci pour votre intérêt pour Loc'Air » + tous les
  supports (présentation + convention + « Signer en ligne »). La fiche
  entre dans Terrain (« À signer », note « Envoi rapide ») ; même e-mail =
  même fiche (`envoi_rapide`, `api/prospection.js`). Bouton « Faire scanner
  le QR code » de la même carte : ouvre `/prospection?visite=1`, le QR code
  s'affiche tout de suite ; le commerçant tape son e-mail lui-même et reçoit
  tout.
5. **Point signé** : compte dans l'objectif (8–10 points, 40 clims).
   Il faut encore l'ajouter à `api/_lib/pointsRetrait.js` et créer le
   commerçant (onglet Partenaires), comme avant.

- **Fichiers :** `api/prospection.js` (tout le serveur), `prospection.html`
  (appli), `partenaires.html` (commerçant ; sans `?s=` : demande de rappel
  très courte, QR code de la fiche mémo), `guide-prospecteur.html`
  (tutoriel des recrues, lié dans l'onglet Tutoriels), `api/_lib/prospection.js`
  (e-mails, SMS, modèle « avant passage »), `api/_lib/conventionPdf.js`
  (convention V11 en PDF, pré-remplie, avec la signature). Table
  `prospection_points` (`supabase/migration_2026-11-25_prospection.sql`,
  ajoute aussi le rôle « prospecteur »). Admin → Points de retrait →
  **Terrain** : tableau par zone, fiches, boutons, messages types.
- **Pièces jointes :** la présentation `documents/locair-devenez-point-de-retrait.pdf`
  (les 8 diapos de la démonstration, allégées à 0,9 Mo ; Brevo refuse
  plus de 10 Mo) + la convention pré-remplie (ou signée). À refaire si la
  présentation change. Expéditeur partenaires.locair@outlook.com quand
  Outlook est relié (sinon contact@locair.fr par Brevo, réponses vers
  partenaires.locair@outlook.com).
- **Convention générée :** texte V11 avec les décisions du propriétaire
  (article 6 : vol ou casse dans la boutique payés par Loc'Air, sans
  exception ; saison 2027 ; stock 3 à 5).
- **E-mails aux commerçants rencontrés** (après visite, signature,
  relance) : autorisés par le propriétaire le 25/11/2026. **Relance du
  lendemain** (`relancerProspection`, `cron-daily.js`) : une seule fois,
  fiches d'hier « À repasser » ou « À signer » avec e-mail/téléphone et
  sans documents envoyés. Le message **« avant passage »** (premier
  contact) n'est jamais envoyé par le site : modèle à copier, envoyé à la
  main depuis partenaires.locair@outlook.com.
- **Suivi Google Sheet :** « Loc'Air — CRM terrain points de retrait »
  (Drive du propriétaire, créée le 25/11/2026 : onglets Tableau de bord et
  Points terrain, statuts en liste, formules au point-virgule).

Le code retour fait 4 caractères (lettres majuscules et chiffres, ex.
« K7P3 »), fixe pour chaque point (voir `codeRetour` dans
`api/_lib/clickCollect.js`). Ne jamais écrire cette règle
dans une page publique, un email client ou une réponse de Julie.

## Outils de prospection (« cerveau + bras »)

L'agent décide (le cerveau) ; des outils branchés agissent pour lui (les
bras). Chaque outil a un seul rôle.

### La base des prospects (le quartier général)

- **Une Google Sheet dans le Drive du propriétaire :** « Loc'Air — Base
  prospects pro ». Créée le 17/11/2026 avec les 100 premiers prospects
  (50 conciergeries, 50 frigoristes). Une ligne = une entreprise.
- **Jamais dans ce dépôt** : tout fichier du dépôt non exclu par
  `.vercelignore` est publié sur locair.fr.
- **Trois canaux seulement :** téléphone, email et courrier
  (publipostage). La base ne garde **que ce qui sert à ces trois
  canaux** ; rien d'autre n'y entre (pas de site web, d'effectif, de
  SIRET, de lien vers une fiche…).
- **Colonnes :** Verticale, Type, Société, Contact (gérant), Téléphone,
  Email, Adresse, Code postal, Ville, Statut, Date dernier contact,
  Prochaine action, Historique des échanges, Notes.
  - **Société** = le nom sous lequel l'entreprise travaille (enseigne).
  - **Contact** = le dirigeant inscrit dans l'annuaire officiel, pour
    « Bonjour {prénom} » et « À l'attention de » sur un courrier.
  - **Adresse / Code postal / Ville** séparés, pour le publipostage. Le
    code postal est du texte (il garde son 0 : `06600`).
- **Statuts possibles** (un seul à la fois) :

| Statut | Veut dire |
|---|---|
| À contacter | Prêt pour le prochain sprint |
| Sans contact | Aucune coordonnée publiée trouvée |
| À vérifier | Doute (entreprise fermée, numéro d'une autre ville…) |
| Contacté | 1er email envoyé |
| Relance 1 | Relance J+5 envoyée |
| Relance 2 | Relance J+12 envoyée (la dernière) |
| Intéressé | A répondu positivement : le propriétaire prend la main |
| Signé | Client ou partenaire |
| Pas intéressé | A dit non poliment ; recontact possible au bout de 3 mois avec un autre angle |
| Stop | Ne plus jamais contacter |

- **Historique des échanges :** une ligne par contact, du plus récent au
  plus ancien : `date — canal — ce qui s'est passé`.
- **Deux onglets :** « Prospects » (une ligne par entreprise ; listes
  déroulantes pour Verticale et Statut, couleurs par statut, filtres) et
  « Tableau de bord » (nombre de prospects par statut et par verticale,
  taux de réponse — tout en formules, rien à remplir).
- **Modifier la Sheet en place** (même fichier, même lien) avec le
  connecteur **Google Sheets** (branché le 17/11/2026). Ne jamais
  recréer le fichier.
- **La Sheet est réglée en français :** dans les formules, séparer les
  arguments par des **points-virgules** (`=COUNTIFS(A:A;"x";B:B;"y")`),
  sinon elles affichent une erreur.

### Les outils branchés (état au 17/11/2026)

| Rôle | Outil | État |
|---|---|---|
| Chercher les entreprises | Annuaire officiel (recherche-entreprises.api.gouv.fr) | ✅ Marche, gratuit |
| Lire leurs sites, trouver téléphone et email | Firecrawl | ✅ Branché (≈ 250 à 400 crédits pour 25 cibles) |
| Fiches Google Maps | — | ❌ Écarté : Google interdit d'aspirer ses fiches |
| Base des prospects | Google Drive / Google Sheets | ✅ Branchés : l'agent lit et modifie la base |
| Envoyer les emails | Brevo | ⏳ Le site l'utilise déjà ; l'agent n'y a pas accès (clé à donner par le formulaire sécurisé) + adresse de prospection séparée à créer |
| Lire les réponses | Boîte mail (ex. Gmail) | ⏳ À brancher |
| Prévenir le propriétaire | Notifications de l'appli admin | ⏳ À relier à l'agent |
| Météo à 7 jours | Open-Meteo via une page du site | ⏳ À construire avant avril |

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
  est dans le dépôt est publié sur Vercel (sauf ce qu'exclut
  `.vercelignore`), donc lisible par n'importe qui sur locair.fr. Les
  listes vivent dans la base Google Sheet (voir « Outils de
  prospection »).
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
- **Suivi :** dans la base Google Sheet, avec ses colonnes et ses
  statuts (voir « Outils de prospection »).

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


## Boucle de prospection quotidienne

Le propriétaire supervise **15 minutes par jour**, en deux moments fixes.
Tout le reste, l'agent le fait seul, en respectant les règles des sprints
ci-dessus.

| Quand | Qui | Quoi |
|---|---|---|
| La nuit | Agent | Trouver et qualifier les cibles du sprint, écrire les emails. |
| **9h00** (10 min) | **Propriétaire** | Lire la liste et les brouillons. Valider, barrer ou corriger. |
| La journée | Agent | Envoyer petit à petit, programmer les relances. |
| Toute la journée | Agent | Trier les réponses, prévenir le propriétaire. |
| **17h30** (5 min) | **Propriétaire** | Lire le bilan du jour. |

### 1. Chercher et qualifier (la nuit)

- **25 cibles qualifiées par jour au maximum**, d'une seule verticale.
- Lire le site de chaque cible. Verticale A : garder celles qui gèrent des
  logements en location courte ; éliminer celles qui ne font que de la
  vente immobilière.
- **Taille :** noter « plus de 15 biens » seulement si c'est visible
  (nombre de logements affichés, « +30 appartements », etc.). Sinon
  « à vérifier » — on n'élimine pas une cible parce qu'on ne sait pas.
- **Nom du gérant :** pris dans l'annuaire officiel des entreprises.
- **Un détail réel** tiré de leur site, avec le lien de la page, pour
  personnaliser l'email. Jamais une affirmation sur une loi ou un
  règlement (« la clim est interdite dans… »). Si rien de précis : pas de
  détail, plutôt qu'un détail inventé.
- Vérifier la liste « déjà contactés » et la liste « stop » avant
  d'ajouter une cible.

### 2. Écrire (la nuit)

- 4 à 5 phrases, ton direct, zéro blabla commercial.
- Utiliser le modèle de la verticale (voir « Modèles d'emails »).
- **Rien ne part sans le feu vert du propriétaire à 9h.** Après 2 ou 3
  sprints sans erreur, il pourra passer à une validation au hasard
  (5 emails sur la liste du jour).

### 3. Envoyer et relancer (la journée)

- **Jamais depuis `contact@locair.fr`** sans l'accord écrit du
  propriétaire : c'est l'adresse des confirmations de réservation des
  vrais clients. Si la prospection la fait classer en spam, les clients ne
  reçoivent plus leurs emails. À utiliser : une adresse à part, sur un
  autre nom de domaine.
- **Échauffement d'une nouvelle adresse :** 10 envois par jour la 1re
  semaine, 20 la 2e, puis 30 maximum. Envois étalés dans la journée.
- **Relances :** à J+5 puis J+12, annulées dès que la personne répond.
  Après la 2e relance, on s'arrête.
- **Freins d'urgence :** plus de 3 % d'emails qui reviennent en erreur,
  ou une plainte pour spam → arrêter tous les envois et prévenir le
  propriétaire. Le mot « STOP » du propriétaire coupe tout.

### 4. Trier les réponses (toute la journée)

- **L'agent ne répond jamais lui-même aux prospects.** Il classe chaque
  réponse et prévient le propriétaire, qui répond lui-même.
- **Intéressé / demande les prix / « appelez-moi »** → alerte immédiate
  au propriétaire (notification de l'appli admin), avec le nom, le numéro
  et la réponse.
- **Stop / pas intéressé** → retiré de la liste pour toujours, sans
  rien lui écrire.
- **Message d'absence** → ignoré, la relance attend.

### 5. Bilan (17h30)

Nombre d'envois, de réponses, de leads chauds, d'erreurs, et ce qui
bloque.

### Outils (état au 17/11/2026)

- **Envoi :** le site utilise déjà Brevo (`api/_lib/brevo.js`, expéditeur
  `contact@locair.fr`). L'agent n'y a pas encore accès : il faut une clé
  Brevo, donnée par le formulaire sécurisé, jamais dans le chat.
- **Lecture des réponses :** Brevo ne lit pas les réponses. Il faut un
  accès à la boîte mail qui les reçoit (par exemple Gmail).
- **Base de prospects :** une Google Sheet (jamais dans ce dépôt).
- **Recherche :** Firecrawl, environ 250 à 400 crédits pour 25 cibles.

## Modèles d'emails

Remplacer `{…}` à chaque envoi. Le `{détail réel}` vient du site de la
cible ; s'il n'y en a pas, enlever la phrase. Signature : `{prénom du
propriétaire}` — à compléter quand il l'aura donné.

### Verticale A — conciergeries, angle « préparer l'été »

**Objet :** Vos voyageurs et la chaleur de l'été prochain

> Bonjour {prénom},
>
> J'ai vu sur votre site que {détail réel}.
>
> L'été, un logement trop chaud, c'est souvent un mauvais avis — et un
> mauvais avis fait perdre des réservations.
>
> Je suis Loc'Air, à Nice : on livre et on installe des climatiseurs
> mobiles en location, sans travaux, le lendemain — et même le jour même
> en 2h si vous appelez avant 18h (option Express).
>
> Enregistrez simplement ce numéro comme « dépannage clim » pour vos
> urgences de l'été prochain : 06 63 79 87 56 (7j/7, 8h–20h).
>
> {prénom du propriétaire} — Loc'Air
> *Vous ne souhaitez plus recevoir nos messages ? Répondez « stop ».*

**Relance J+5 :**

> Bonjour {prénom}, je me permets de revenir vers vous : quand la chaleur
> arrive, les conciergeries qui ont déjà un numéro de dépannage gagnent un
> temps précieux. Le nôtre : 06 63 79 87 56. Bonne journée,
> {prénom du propriétaire} — Loc'Air.
> *Répondez « stop » pour ne plus rien recevoir.*

**Relance J+12 (la dernière) :**

> Bonjour {prénom}, dernier message de ma part : si un jour un voyageur a
> trop chaud dans un de vos logements, on peut livrer un climatiseur le
> jour même. Je vous souhaite une belle saison, {prénom du propriétaire}
> — Loc'Air, 06 63 79 87 56.
> *Répondez « stop » pour ne plus rien recevoir.*

## Déclencheur météo (chaque lundi)

Une tâche planifiée réveille l'agent **chaque lundi à 8h (heure de
Paris)**. Elle n'est utile que **d'avril à septembre** ; le reste de
l'année, l'agent continue juste la prospection de fond.

### Lire la météo

- Température maximale prévue sur les **7 jours à venir**, à **Nice,
  Cannes et Antibes** (là où sont les clients). On retient la plus haute.
- Source : Open-Meteo (gratuit, déjà utilisé par le site). Depuis la
  machine de l'agent, il refuse parfois (« limite du jour atteinte »,
  machine partagée). Solution prévue : une petite page du site (comme
  `api/adstay-meteo.js`) qui donne la prévision de la semaine, appelée par
  l'agent. À construire avant la première saison.
- Si la météo est illisible : ne rien envoyer, prévenir le propriétaire.

### Trois niveaux

| Maximum prévu | Mode | Ce que fait l'agent |
|---|---|---|
| Moins de 27 °C | **Calme** | Prospection de fond normale. |
| 27 à 28 °C | **Vigilance** | Prospection normale + prévenir le propriétaire qu'un pic peut arriver (vérifier le stock). |
| 29 °C et plus | **Urgence** | Préparer l'alerte chaleur (ci-dessous). |

### Mode urgence

1. L'agent prépare l'email d'alerte et la liste des destinataires, et
   envoie au propriétaire : la prévision (jour, ville, température), le
   nombre de destinataires, l'email.
2. **Le propriétaire répond « GO » et donne le stock réellement
   disponible.** Rien ne part sans ça : pendant une vague de chaleur, on
   ne promet jamais une disponibilité sans avoir vérifié le stock.
3. L'agent envoie, au rythme permis par l'adresse d'envoi.

**Qui reçoit l'alerte (la « base tiède ») :** les prospects déjà
contactés pendant la saison, qui n'ont pas dit stop, et qui n'ont pas
encore reçu d'alerte chaleur depuis 30 jours. **Une alerte chaleur au
maximum par prospect et par mois.** On ne trie pas sur « a ouvert
l'email » : les ouvertures sont peu fiables (certaines boîtes mail les
déclenchent toutes seules) et les suivre demande des précautions CNIL.

**Ce qu'on ne fait pas :** inventer une rareté (« nos 10 dernières
machines ») ou promettre un stock bloqué pour eux. Un chiffre de stock
n'est écrit que s'il est vrai, donné par le propriétaire le jour même.

**Modèle d'alerte chaleur :**

**Objet :** {température} °C annoncés {jour} sur la Côte d'Azur

> Bonjour {prénom},
>
> Météo : {température} °C annoncés {jour} à {ville}.
>
> Dans ces moments-là, nos climatiseurs partent vite. {Phrase de stock
> donnée par le propriétaire, ex. « Il nous en reste 8 pour cette
> semaine. » — sinon enlever la phrase.}
>
> Pour en réserver pour vos logements, répondez « OUI » ou appelez le
> 06 63 79 87 56 (7j/7, 8h–20h). On confirme la date par téléphone.
>
> {prénom du propriétaire} — Loc'Air
> *Vous ne souhaitez plus recevoir nos messages ? Répondez « stop ».*

Chaque « OUI » est un lead chaud : alerte immédiate au propriétaire, qui
rappelle et confirme le stock.

### La tâche planifiée

À créer seulement quand l'envoi d'emails marche (clé Brevo et adresse de
prospection prêtes), et pas avant avril. Horaire : lundi 7h53 (heure de
Paris), un peu avant 8h pour éviter l'embouteillage de l'heure pile.

## Planning annuel des emails

Le fil rouge de l'année : **on prépare l'été pendant l'hiver**, on sert les
clients pendant l'été, et on parle chauffage (PortaSplit) à l'automne.
Toujours **une seule verticale en prospection à la fois** (voir les
sprints). Chaque message saisonnier est écrit à partir des règles de sa
verticale et **validé par le propriétaire avant le premier envoi** ; seul
le modèle « préparer l'été » (verticale A) existe déjà.

### Règles de fréquence (pour ne jamais devenir du spam)

- **Une séquence = 1 email + 2 relances au plus** (J+5, J+12).
- Après une séquence sans réponse : **pause d'au moins 3 mois** avant de
  recontacter la même personne, et avec un **angle nouveau** (pas le même
  message renvoyé).
- **Au plus 1 séquence par trimestre et par prospect.** L'alerte chaleur
  (voir « Déclencheur météo ») est à part : 1 par mois au plus, d'avril à
  septembre.
- **Pas d'envoi du 20 décembre au 5 janvier**, ni le week-end, ni les
  jours fériés.
- « Stop » = plus jamais. La liste stop est vérifiée avant chaque envoi.
- Les **clients** (ceux qui ont déjà loué) ont leur propre fil, plus
  léger, ci-dessous. Ils ne reçoivent jamais les emails de prospection.

### Vue d'ensemble : qui est en prospection quel mois

Une seule verticale en sprint de prospection à la fois. Les autres lignes
de chaque mois sont des envois à des contacts **déjà connus** (suivi,
relance saisonnière), pas de nouvelles cibles.

| Mois | Sprint de prospection |
|---|---|
| Novembre | Mise en place (adresse de prospection + échauffement), listes C et D |
| Décembre (→ 19) | **A** Conciergeries |
| Janvier (6 →) | **A** Conciergeries (suite) |
| Février | **B** Installateurs |
| Mars | **C** Syndics & agences |
| Avril | **D** Campings, résidences, événementiel |
| Mai | **D** (événements de l'été) |
| Juin – août | Aucun sprint froid : alertes chaleur et clients |
| Septembre | Bilan de saison |
| Octobre | **A** puis **C** : angle PortaSplit hiver |
| Novembre | Nouvelles listes pour l'année suivante |

### Verticale A — Conciergeries & gestionnaires Airbnb

| Mois | Envoi | Message |
|---|---|---|
| Décembre – janvier | **Séquence de prospection** (email + J+5 + J+12) | « Préparez l'été dès maintenant » — modèle existant |
| Avril | **Ouverture de saison** (1 email, non-stop, au moins 3 mois après leur dernier email) | « La saison commence : notre numéro dépannage clim et l'Express 2h le jour même » |
| Avril – septembre | **Alerte chaleur** (1 par mois au plus, seulement si ≥ 29 °C et « GO » du propriétaire) | Modèle d'alerte chaleur |
| Octobre | **Séquence hiver** (email + J+5 + J+12) | « Chauffer vos logements loués cet hiver, sans travaux » — PortaSplit |

### Verticale B — Installateurs de clim fixe & frigoristes

| Mois | Envoi | Message |
|---|---|---|
| Février | **Séquence de prospection** (email + J+5 + J+12) | « Devenez partenaire avant la saison : vos clients qui attendent un chantier n'auront plus chaud, et vous touchez une commission » |
| Mai | **Rappel aux partenaires inscrits** (1 email) | « La saison arrive : pensez à donner votre lien / QR code à vos clients en attente » |
| Mai | **Seconde chance** aux non-inscrits non-stop (1 email, 3 mois après) | « Vos chantiers de l'été vont s'accumuler : un appareil pour patienter » |
| Septembre | **Bilan aux partenaires** (1 email) | Leurs clients envoyés et leur commission de la saison (chiffres de l'espace partenaire) |
| — | Pas d'alerte chaleur | Ce ne sont pas eux qui louent |

### Verticale C — Syndics & agences de gestion locative

| Mois | Envoi | Message |
|---|---|---|
| Mars | **Séquence de prospection** (email + J+5 + J+12) | « Pannes de clim chez vos locataires cet été : une solution dès le lendemain, payée par le locataire, sans travaux » |
| Juin | **Rappel avant l'été** (1 email, non-stop, 3 mois après) | « Gardez notre numéro pour vos locataires en panne » |
| Octobre | **Séquence hiver** (email + J+5 + J+12) | « Chauffage en panne chez un locataire : un PortaSplit le lendemain » |
| — | Pas d'alerte chaleur | Ils ne louent pas eux-mêmes ; c'est le locataire qui commande |

### Verticale D — Campings, résidences de tourisme & événementiel

| Mois | Envoi | Message |
|---|---|---|
| Avril | **Séquence de prospection** (email + J+5 + J+12) | « Réservez vos dates chargées de l'été maintenant » |
| Mai | **Séquence événements** (organisateurs, salles, nouvelles cibles) | « Mariages, salons, tournages : rafraîchir sans faire sauter l'électricité » — rafraîchisseur dès 1 jour |
| Juin – septembre | **Alerte chaleur** (1 par mois au plus, ≥ 29 °C, « GO » + stock réel du propriétaire) | Modèle d'alerte chaleur, version « vos clients / vos invités » |
| Septembre | **Bilan** aux clients de la saison (1 email) | « Merci pour la saison » + réserver tôt l'an prochain |
| — | Pas de séquence en hiver | Rien à leur proposer d'octobre à février |

### Le fil des clients (ceux qui ont déjà loué)

3 emails par an au plus, en dehors des confirmations de réservation :

1. **Avril** — « On est prêts pour l'été » : rappel du numéro, de
   l'Express 2h et de la remise quantité.
2. **Septembre** — « Merci pour la saison » + une seule question.
3. **Octobre** — l'offre hiver PortaSplit (seulement pour ceux à qui elle
   peut servir : logements loués toute l'année, bureaux).

### Avant chaque mois

L'agent prépare, pour le propriétaire : la liste du mois, le brouillon de
chaque nouveau message et le nombre d'envois prévus. **Rien ne part sans
sa validation** (règle de la boucle quotidienne).
