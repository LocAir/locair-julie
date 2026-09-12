# Vendre des climatiseurs — ce qui est fait, ce qui manque

Ce fichier est votre liste. Tout ce que je ne pouvais pas inventer est
là-dedans.

---

## Ce qui est déjà en place

**La page** : `/acheter-climatiseur`.
Elle est indexable par Google (elle n'est bloquée ni dans `robots.txt` ni
par un en-tête), elle est dans le `sitemap.xml`, et elle porte déjà le fil
d'Ariane et les questions-réponses que Google sait afficher.

**La porte d'entrée depuis le site** : sous le tableau « Acheter ou louer »
de la page d'accueil, un bouton « Vous comptez le garder ? On le vend
aussi ». Il tombe exactement là où la question se pose.

**L'argument, sans se contredire.** C'est le point important. Votre tableau
dit déjà, noir sur blanc, dans sa dernière ligne :

> « Si vous l'utilisez cinq étés de suite → **l'achat finit moins cher.** »

Le site reconnaissait donc déjà que l'achat gagne dans ce cas — et il
n'offrait rien à ces gens-là. La page de vente est la réponse qui manquait,
pas un revirement. L'argument ne change pas : ce n'est pas l'achat qui est
un mauvais deal, c'est **l'achat en magasin**, où l'on repart avec un
carton, sans kit, sans pose et sans personne à rappeler.

---

## ⚠ À FAIRE EN PREMIER : coller le SQL dans Supabase

Je n'ai **aucun accès** à votre base de production. Le code est déployé,
mais les colonnes de vente n'existent pas tant que vous n'avez pas fait ça :

1. Ouvrez **Supabase → SQL Editor**
2. Collez tout le contenu de `supabase/migration_vente_catalogue.sql`
3. Exécutez
4. Rechargez l'onglet **Vente** de l'admin

**Rien ne casse si vous ne le faites pas tout de suite.** Le code vérifie :
sans les colonnes, l'onglet Vente affiche « colle d'abord ce SQL », et la
page `/acheter-climatiseur` continue simplement de demander un devis. C'est
exactement ce qui s'est passé avec `reservations.masquee` : du code déployé
plus vite qu'une migration. Cette fois c'est prévu.

---

## Ce que vous remplissez vous-même, dans l'admin

**Onglet « Vente »**, à côté de Tarifs. Il liste vos modèles de climatiseur
(ceux du catalogue qui sert déjà « Mon climatiseur » dans l'espace client) et
vous laisse remplir, pour chacun :

| Champ | Ce que ça fait sur le site |
|---|---|
| **Prix de vente TTC** | Le gros chiffre en haut de la page |
| **Stock neuf** | En dessous de 1, le modèle disparaît de la page |
| **Délai (jours)** | « Livré sous 5 jours » |
| **Garantie fabricant (mois)** | « 24 mois, en plus des 2 ans de garantie légale » |
| **Installation (€)** | `0` = « livraison et installation comprises » ; vide = non proposée |

Puis le bouton **« Mettre en vente »**. Le serveur refuse de mettre en vente
un modèle sans prix ou sans stock — sinon vous croiriez avoir publié quelque
chose que la page filtre en silence.

**Le stock de vente n'a rien à voir avec le parc de location.** Ce sont des
machines neuves commandées pour être revendues ; elles n'entrent jamais dans
le calcul de disponibilité de la location.

Dès qu'un modèle est en vente, la page d'achat passe toute seule de
« demander le prix » à une vraie fiche produit.

---

## Ce qui reste à décider (et que je ne peux pas inventer)

Rien de tout cela n'est inventé sur la page. Les blocs qui en ont besoin
sont écrits mais **masqués** tant que les vraies valeurs n'existent pas.

| # | Ce qu'il me faut | Pourquoi |
|---|---|---|
| 1 | **Le ou les modèles vendus** — marque et référence exacte | La page ne cite aucun modèle. Vos CGV de location citent le Rowenta RWAC10KA et le FRICO CLIMOB 12, mais ce sont vos machines de **location**. |
| 2 | **Le prix de vente**, TTC, et ce qu'il comprend | Aucun prix n'est affiché. Sans prix, la page demande un devis. |
| 3 | **Le délai de livraison** pour un achat | Différent de la location : vous commandez la machine. |
| 4 | **La durée de la garantie du fabricant** | Elle s'ajoute à la garantie légale de 2 ans, elle ne la remplace pas. |
| 5 | **L'installation : comprise ou en option ?** Et si en option, son prix | En location elle est à 80 €. Pour la vente, c'est à vous de dire. |
| 6 | **La zone de livraison pour la vente** | Une vente n'a pas de reprise : vous pouvez livrer plus loin qu'en location. |

Dès que vous me donnez ces six lignes, la page passe de « demander le prix »
à une vraie fiche produit, avec la fiche Google `Product` qui va avec.

---

## Ce qui doit être écrit avant la première vente

### Les conditions de vente

**Vos CGV actuelles sont des CGV de location, et elles ne couvrent pas la
vente.** Mesuré dans le fichier :

- L'article 1 dit « prestataire de **location** de climatiseurs mobiles ».
- L'article 11 cite les articles 1719 et suivants du Code civil — le droit
  du **bail**.
- L'article 6 **supprime** le droit de rétractation de 14 jours, parce
  qu'une prestation qui commence tout de suite le permet.

Pour une vente, les trois sont faux :

| | Location (aujourd'hui) | Vente (ce qu'il faut) |
|---|---|---|
| Rétractation 14 jours | écartée, et c'est légal | **obligatoire** (L.221-18) |
| Garantie | droit du bail (Code civil 1719) | **garantie légale de conformité, 2 ans** (L.217-3) |
| Vices cachés | déjà présent | idem, 2 ans à partir de la découverte |
| Qui répond de la panne | vous, pendant la location | **vous, comme vendeur** |

Il faut donc une page `/cgv-vente` distincte. Tant qu'elle n'existe pas, la
page d'achat ne conclut **aucune vente en ligne** : elle demande un devis,
et les conditions sont remises avec le devis. C'est volontaire et c'est sûr.

### La facture

Une vente, ce n'est pas une facture de location. Mention de la TVA,
désignation du bien, garanties légales rappelées.

---

## Google Ads — comment ne pas piloter à l'aveugle

### Une campagne séparée, et une conversion séparée

Le site utilise déjà le compte `AW-18195242550`, chargé seulement après
accord sur les cookies. Aujourd'hui, **une seule conversion** est déclarée,
après le paiement, avec le montant réellement débité.

Si une vente tombe dans le **même panier** que les locations, la machine
d'enchères de Google va comparer des montants sans rapport et se mettre à
courir après les gros chiffres — au détriment de la location, qui est votre
métier. Ou l'inverse.

**Il faut donc deux actions de conversion distinctes :**

| Action | Se déclenche | Valeur |
|---|---|---|
| `Location` (existe déjà) | après paiement de la location | le montant débité |
| `Achat` (à créer) | après paiement de la vente | le montant de la vente |

Et chaque campagne optimise sur la sienne, jamais sur les deux.

### Le mot-clé et la page doivent dire la même chose

Google note la cohérence entre l'annonce et la page d'arrivée. Une annonce
« acheter climatiseur » qui tombe sur une page de location est mal notée, et
**le clic coûte plus cher**. C'est toute la raison d'être d'une page séparée.

### Les mots-clés à exclure, des deux côtés

C'est le point que tout le monde oublie et qui coûte le plus cher : vos deux
campagnes vont se voler leurs propres clics.

- Dans la campagne **achat**, excluez : `location`, `louer`, `à louer`, `prix
  location`, `journée`, `semaine`.
- Dans la campagne **location**, excluez : `acheter`, `achat`, `prix d'achat`,
  `neuf`, `occasion`, `vente`.

### Le suivi du clic

Quand quelqu'un arrive d'une annonce, Google ajoute un identifiant (`gclid`)
à l'adresse. Le site le transporte déjà d'une page à l'autre. **La page
d'achat devra faire pareil** le jour où elle mènera à un tunnel de paiement,
sinon Google ne saura pas relier la vente à l'annonce.

---

## Ce qu'il ne faut pas faire

**Ne mettez pas « Acheter » dans le menu principal, à côté de « Réserver ».**
Le site convertit aujourd'hui parce qu'il dit une seule chose. Deux appels à
l'action côte à côte, c'est un visiteur qui hésite — et un visiteur qui
hésite s'en va. La porte sous le tableau comparatif suffit : elle s'ouvre au
moment où la question se pose, et pas avant.

**Ne retirez pas le tableau « Acheter ou louer ».** C'est lui qui rend la
vente crédible. Un site qui dit « la location est mieux **sauf si vous le
gardez plusieurs étés, et dans ce cas achetez, même chez nous** » est plus
solide qu'un site qui essaie de tout vendre à tout le monde.

---

## Ce qui existe déjà côté logiciel, et qui resservira

Le système sait déjà vendre une machine — c'est l'**Offre Privilège** :

- `appareils.statut` accepte la valeur `vendu` ;
- l'admin propose l'offre, le client paie par Stripe depuis son espace ;
- le webhook marque l'appareil `vendu`, annule la récupération et le sort du
  parc de location.

C'est une vente **d'occasion, au client qui loue déjà**, au cas par cas.
Pour vendre du neuf à n'importe qui, il faudra une table de produits avec
prix et stock — mais le paiement, la facture et la sortie de parc existent
déjà et ne sont pas à réécrire.
