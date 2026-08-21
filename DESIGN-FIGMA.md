# Design graphique Loc'Air — fichier Figma

Fichier : **Loc'Air — Design du site**
https://www.figma.com/design/fWXA5BKTCSrfypmoMjjyoN

But : pouvoir changer le look du site (couleurs, typos, boutons) directement
dans Figma, puis remettre ces changements dans le code du site.

## Ce qu'il y a dans le fichier

### Page « 🎨 Styles »
Les briques de base. On change une valeur ici, ça change partout.

**Couleurs** (nommées `couleur/...`)

| Nom Figma | Code | Où c'est utilisé |
|---|---|---|
| couleur/marine | `#1a2b4a` | Titres, boutons foncés, logo |
| couleur/marine-fonce | `#12203a` | Texte sur bouton doré |
| couleur/or | `#c5a96c` | Bouton principal, accents |
| couleur/fond | `#f4f6f9` | Fond des sections grises |
| couleur/fond-2 | `#e8ecf2` | Fond secondaire |
| couleur/blanc | `#ffffff` | Fond des cartes |
| couleur/texte | `#1a1a1a` | Texte principal |
| couleur/texte-2 | `#555555` | Texte secondaire |
| couleur/texte-3 | `#888888` | Petits textes gris |
| couleur/trait | `#e4e4e4` | Bordures |
| couleur/vert | `#16a34a` | Remises, dispo |
| couleur/rouge | `#dc2626` | Erreurs |

Plus : `arrondi/...` (8, 12, 20, 999 px) et `espace/...` (8 à 96 px).

**Typos** (styles de texte)
- Titre/Hero — Inter Extra Bold 62
- Titre/Section — Cormorant Garamond SemiBold 58
- Titre/Sous-section, Titre/Carte, Titre/Petit
- Corps/Grand, Corps/Normal, Corps/Petit
- Bouton, Bouton/Petit, Sur-titre, Nav/Lien, Micro, Logo

**Ombres** : Ombre/XS, SM, MD, LG, Marine, Or.

**Composants réutilisables**
- `Bouton` — 6 versions : Principal / Secondaire / Sombre × Grand / Petit
- `Item réassurance`
- `Carte étape`

### Page « 🏠 Accueil »
La page d'accueil refaite à l'identique, en 1440 px de large :
1. Navigation
2. Hero (texte + photo du climatiseur)
3. Réassurance (4 blocs)
4. Comment ça marche (4 étapes)
5. Produit (fiche + caractéristiques)
6. Tarifs (prix, paliers dégressifs, louer vs acheter)

## Ce qui reste à faire
- Sections Avis, FAQ, CTA final, Footer
- Retirer l'emoji 🔧 dans la ligne « Installation par technicien » (Figma ne
  l'affiche pas)
- Remplacer la photo du hero par le fichier `hero-clim.jpg` en pleine qualité
  (celle importée est une version allégée)

Blocage rencontré : le plan Figma **Starter (gratuit)** limite le nombre
d'actions automatiques par jour. La limite a été atteinte — il faut soit
attendre le renouvellement du quota, soit passer sur un plan payant pour
finir les 4 dernières sections automatiquement.

## Direction graphique retenue : Landify

Template de référence :
https://www.figma.com/community/file/894552273937682724/landify-landing-page-ui-kit-v2

Ce qu'on lui prend : les formes et les espacements (grandes cartes arrondies,
bordures fines gris clair, ombres douces, boutons pilule, gros titres Inter en
gras, beaucoup de blanc). Ce qu'on garde de Loc'Air : le marine `#1a2b4a` et
l'or `#c5a96c`.

Changement notable : les titres passent du serif (Cormorant Garamond) au sans
serif Inter en très gras. C'est ce qui donne le côté moderne / pro.

### Aperçu en vrai
Fichier : `apercu-landify.html` → `https://www.locair.fr/apercu-landify.html`
(page non indexée, elle ne remplace rien). C'est la page d'accueil complète
habillée en style Landify : navigation, hero, **grille bento**, 4 étapes,
produit, tarifs, avis, FAQ dépliable, gros bloc final, pied de page.

Toute la page est construite sur la même grille bento : 4 colonnes sur
ordinateur, 2 sur téléphone, avec des tuiles de tailles différentes
(1×1, 2×1, 2×2).

- **Engagements** : grande tuile sombre avec photo, tuiles chiffres
  (24h, 0 €, +500), note Google en tuile large, paiement, paliers de prix
- **Étapes** : étapes 1 et 4 en tuiles larges, 2 et 3 en petites, plus une
  tuile sombre « Prêt à dormir au frais ? » avec le bouton de réservation
- **Produit** : photo en grande tuile 2×2, texte en tuile large, les 4
  caractéristiques (BTU, m², dB, classe A) en petites tuiles chiffres,
  le kit fourni en tuile large
- **Tarifs** : le prix en grande tuile 2×2 avec le bouton, les paliers et
  « louer plutôt qu'acheter » en tuiles larges, et 4 petites tuiles
  conditions (caution, livraison, installation, annulation)
- **Avis** : l'avis vedette en grande tuile sombre 2×2, 5 avis en tuiles,
  la note 4,9 en tuile large
- **FAQ** : la liste dépliable sur 3 colonnes, plus une tuile contact
  (téléphone + WhatsApp) à droite

Si le rendu convient, l'étape suivante est de reporter ces styles dans
`index.html` (le vrai site).

## Comment on travaille ensuite
1. Tu modifies dans Figma (couleurs, typos, espacements, mise en page).
2. On relit le fichier Figma et on reporte les changements dans
   `index.html` (les variables CSS en haut du fichier, autour de la ligne 178).


## Version B — communication retravaillée

Direction retenue par le propriétaire : la **version B** (`version-b.html`),
« une idée par écran ». La mise en page n'a pas bougé — seuls les textes ont
été réécrits, dans un ton **service, efficace et sympa**.

Le principe de la réécriture :
- on parle de ce qu'**on fait pour le client**, pas de ce qu'on vend
  (« quelqu'un sonne chez vous » → « on sonne chez vous »)
- on remplace les formules défensives par des formules d'accueil
  (« C'est écrit dans votre contrat, pas dans un slogan » → « C'est écrit
  noir sur blanc dans votre contrat »)
- les questions sont posées comme au téléphone (« Qui pose l'appareil ? » →
  « On vous la pose ? », « Un technicien vient » → « Oui, venez la poser »)
- phrases courtes, aucune formule commerciale

46 textes réécrits, du titre d'accueil au pied de page.

Note : la photo du hero utilise le chemin absolu `/hero-clim.jpg`. Elle
s'affiche correctement sur le serveur ; elle apparaît vide uniquement si on
ouvre le fichier en local depuis le disque.


## Version B — fonds des écrans réorganisés

Mêmes couleurs qu'avant, mais réparties autrement entre les écrans.

Deux problèmes réglés :
- les écrans 7 et 8 étaient tous les deux marine, collés l'un à l'autre —
  aucune respiration entre les deux ;
- le bleu, la couleur la plus forte, servait sur « En cas de souci » alors
  que le message le plus vendeur est « 0 € de caution ».

| Écran | Avant | Après |
|---|---|---|
| 1 · Accueil | blanc | blanc |
| 2 · Chez vous | marine | marine |
| 3 · Aucune caution | gris clair | **bleu** |
| 4 · Le prix | blanc | **gris clair** |
| 5 · Votre devis | gris clair | **blanc** |
| 6 · En cas de souci | bleu | **marine** |
| 7 · Nos clients | marine | **gris clair** |
| 8 · Qui vient chez vous | marine | marine |
| 9 · Zone de livraison | gris clair | **blanc** |
| 10 · Questions | blanc | **gris clair** |
| 11 · Réserver | marine | marine |

Plus aucun écran ne touche un écran de la même couleur, et le bleu ne sert
qu'une seule fois — sur la promesse la plus forte.

Corrections rendues nécessaires par le déplacement du mur de vidéos sur fond
clair : le nom des clients héritait de la couleur du texte de l'écran et
devenait invisible sur les cartes sombres ; la carte « Vous avez loué chez
nous ? » était en blanc sur blanc ; et la barre de défilement du mur était
blanche.
