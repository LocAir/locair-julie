# Tout ce qui manque au site, côté visuel

*Photos · vidéos · bandeaux · logo · police. Un seul document, par ordre
d'urgence. Chaque entrée dit le nom du fichier, le format, ce qu'il faut
dans le cadre, et où ça se branche.*

Le site n'a **aucune image**. C'est ce qui lui manque le plus — tout le
reste (couleurs, structure, contrastes, textes) est fait et mesuré.

Une règle vaut pour tout ce document : **rien de ce qui est demandé ici
n'est décoratif.** Chaque fichier remplit un vide précis, mesuré, à un
endroit précis. Si un fichier n'arrive jamais, l'emplacement reste
invisible et la page tient quand même — mais elle tient moins bien.

Ce fichier dit exactement quoi photographier, dans quel format, et où ça
se branche. Les emplacements sont **déjà prêts dans le code** : ils
réservent leur proportion, se chargent en différé, et restent invisibles
tant que le fichier n'existe pas. Il n'y a donc **rien à coder** : il
suffit de déposer les fichiers à la racine du dossier, avec le bon nom.

---

## Comment préparer un fichier

Pour chaque photo, trois tailles, en JPEG de qualité 80 :

    nom-600.jpg     600 px de large
    nom-900.jpg     900 px
    nom-1400.jpg   1400 px

Le navigateur choisit la bonne selon l'écran du visiteur — un téléphone ne
télécharge jamais la grande. Viser **moins de 150 Ko** pour la 900.

Photographier **au téléphone récent, en lumière du jour**, jamais au flash.
Pas de filtre, pas de retouche lourde : le site dit « pas d'acteurs, pas de
studio », les images doivent le confirmer.

---

## 1. L'accueil — la photo la plus importante

**Fichier :** `photo-pose-600.jpg` / `-900.jpg` / `-1400.jpg`
**Proportion :** 4:5 vertical (par exemple 1200 × 1500)

**Ce qu'il faut dans le cadre :** un technicien en train de poser le kit de
calfeutrage sur la fenêtre, **chez un client**, en lumière naturelle. On
doit voir les mains, la fenêtre, l'appareil au sol.

**Ce qu'il ne faut PAS :** l'appareil seul sur fond blanc. Ça, tout le
monde l'a. Ce qui vous distingue, c'est que quelqu'un se déplace et le
pose. La photo doit montrer le service, pas le produit.

Elle remplit le vide à droite du titre — mesuré : sur un écran de 1900 px,
c'est aujourd'hui la moitié de l'écran d'accueil qui est vide.

---

## 2. Les deux machines — écran « Le matériel »

**Fichiers :** `photo-clim-*.jpg` et `photo-rafraichisseur-*.jpg`
**Proportion :** 1:1 carré (par exemple 1000 × 1000)

- **Le climatiseur** : le De'Longhi Pinguino installé dans un salon ou une
  chambre, gaine posée sur la fenêtre, kit en place.
- **Le rafraîchisseur** : l'appareil sur une terrasse, un garage ou un
  atelier — un espace ouvert, puisque c'est là qu'il sert.

**Pourquoi c'est urgent :** un visiteur ne sait pas à quoi ressemble un
rafraîchisseur d'air. Aujourd'hui il doit l'imaginer. La moitié de votre
offre est invisible.

---

## 3. Les cinq vidéos clients — écran « Les clients »

**Fichiers :** `videos/client-1.mp4` … `client-5.mp4`, plus une image
d'attente `videos/client-1.jpg` … pour chacune.
**Proportion :** 9:16 vertical, comme une story. 15 à 30 secondes.

Un client qui dit ce qu'il a loué, combien de temps, et comment ça s'est
passé. Filmé au téléphone, tenu à la verticale, sans montage.

**Le code est déjà là** : cinq emplacements attendent dans le rail, et le
mode d'emploi est écrit en commentaire juste au-dessus dans version-b.html.
Rien ne se télécharge avant que le visiteur clique.

---

## 4. La preuve que la plateforme existe — écran « Sous le capot »

**Fichiers :** `photo-app-*.jpg` (proportion 9:19,5, un écran de téléphone)
et `photo-espace-*.jpg` (proportion 16:10).

Deux captures d'écran : l'application du transporteur pendant une tournée,
et l'espace client. L'écran dit « nous n'achetons pas un logiciel de
location, nous l'écrivons » — et rien ne le montre.

---

## 5. Optionnel — la camionnette

**Fichier :** `photo-camion-*.jpg`, proportion 3:2.
La camionnette devant un immeuble, tôt le matin. Ça ancre l'heure, qui est
la promesse centrale de Loc'Air.

---

## 6. Les bandeaux des pages de ville

**Fichiers :** `ville-cannes-*.jpg`, `ville-antibes-*.jpg`,
`ville-monaco-*.jpg`, `ville-menton-*.jpg`
**Proportion :** 3:2 paysage (par exemple 1600 × 1067)

Quatre pages existent — `/location-climatiseur-cannes` et les trois
autres — et **aucune ne montre la ville**. Un visiteur de Menton doit
reconnaître chez lui en une seconde.

**Ce qu'il faut dans le cadre :** un lieu identifiable, pris de jour, en
été. La Croisette, le port Vauban, le port de Monaco, la baie de Garavan.
Une photo prise par vous vaut mieux qu'une banque d'images : personne ne
reconnaît un cliché de stock, et tout le monde reconnaît une vraie rue.

**Si vous n'avez qu'une seule photo par ville, c'est déjà assez.** Une
photo réelle de la ville bat quatre images achetées.

---

## 7. Les bandeaux de partage (Facebook, WhatsApp, iMessage)

**Fichier :** `og-locair.png` — **il existe déjà**, fabriqué à partir de
la marque : 1200 × 630, fond marine, nom et promesse.

Ce qui manquerait, si vous voulez aller plus loin : **une version par
famille de page** — une pour les guides, une pour les pages de ville.
C'est ce qui s'affiche quand quelqu'un colle votre lien dans WhatsApp,
et c'est souvent la première image que voit un client.

**Proportion :** 1200 × 630 exactement, PNG ou JPEG, moins de 300 Ko.
Le texte doit rester dans les 1000 px centraux : WhatsApp recadre les
bords.

Je peux les fabriquer moi-même à partir de la marque, comme celui qui
existe — **mais avec une vraie photo dedans, ils changeraient de niveau.**

---

## 8. Le logo — les fichiers sources

Aujourd'hui, « Loc'Air » est **composé en typographie** dans la page :
le nom en DM Sans gras, et l'apostrophe remplacée par une goutte dorée
dessinée en CSS. Ça marche, c'est net à toutes les tailles, et ça pèse
zéro. Mais ce n'est pas un logo : c'est un traitement typographique.

Si un logo existe, il me faut :

| Fichier | Pour quoi |
|---|---|
| `logo.svg` | vectoriel, version couleur — le seul format qui reste net partout |
| `logo-blanc.svg` | version pour fond sombre (barre, pied de page) |
| `logo-mono.svg` | version une seule couleur, pour un tampon ou une facture |
| `logo.png` | 1024 px de large, fond transparent, pour ce qui n'accepte pas le SVG |

**S'il n'existe pas encore :** dites-le-moi. Le traitement actuel — le nom
plus la goutte — est déjà une identité cohérente, présente sur chaque
page, dans le favicon et dans le bandeau de partage. Il peut devenir un
vrai logo sans repartir de zéro.

---

## 9. La police de titrage

C'est le point que vous placez « presque aussi important que le logo », et
vous avez raison : **c'est ce qui rend une page reconnaissable avant même
la couleur.** Aujourd'hui, titres et texte courant sont dans la même
police (DM Sans), ce qui est propre mais anonyme.

Deux façons d'avancer :

1. **Une police gratuite**, chargée depuis Google Fonts. Coût : entre 15
   et 22 Ko. J'en ai testé plusieurs sur le vrai titre de l'accueil, en
   français et en russe — le russe est une contrainte réelle, beaucoup de
   polices ne le couvrent pas et le titre retomberait sur une police par
   défaut.

2. **Une police achetée**, si vous voulez quelque chose que personne
   d'autre n'a. Il me faut alors les fichiers `.woff2` **et** la licence
   qui autorise l'usage web (« webfont licence »). Sans elle, on ne peut
   pas la mettre en ligne.

**Ce dont j'ai besoin de vous :** soit votre choix parmi ce que je vous
montre, soit les fichiers si vous en avez déjà une.

---

## 10. Ce que je ne vous demande pas

Pour être clair sur ce qui n'est **pas** utile :

- **Pas de photos de banque d'images.** Le site répète qu'il n'y a ni
  acteurs ni studio ; une photo de stock contredit tout le reste.
- **Pas d'appareil sur fond blanc.** C'est la photo que tout le monde a,
  et elle montre le produit alors que vous vendez le service.
- **Pas de retouche lourde, pas de filtre.** La lumière du jour suffit.
- **Pas de photo où l'on reconnaît un client** sans son accord écrit.

---

## Ordre de priorité

| | Ce que ça débloque |
|---|---|
| 1. La pose chez un client | Le vide de l'écran d'accueil, et la preuve qu'on se déplace |
| 2. Le rafraîchisseur | La moitié de l'offre, aujourd'hui invisible |
| 3. Les vidéos clients | La preuve sociale — cinq emplacements vides attendent |
| 4. Le climatiseur | Complète la comparaison des deux machines |
| 5. Les captures | La crédibilité technique |
| 6. Les bandeaux de ville | Quatre pages qui ne montrent pas leur ville |
| 7. La camionnette | Confort |
| 8. Le logo et la police | L'identité — le reste marche sans, mais reste anonyme |

---

## Une note sur les tailles

Les hauteurs sont bornées dans le code pour qu'une photo ne fasse jamais
exploser la hauteur d'un écran — c'est mesuré : sans borne, une photo 4:5
sur l'accueil faisait passer l'écran de 618 à 1254 px, soit le double d'un
écran d'ordinateur.

Ces bornes sont un point de départ raisonnable. Le jour où les vraies
photos arrivent, il faudra les régler **avec les images sous les yeux** :
un cadrage serré supporte une petite hauteur, un plan large a besoin de
place. C'est un réglage de dix minutes, pas une refonte.
