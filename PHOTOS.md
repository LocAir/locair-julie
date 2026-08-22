# Les photos et vidéos qui manquent

Le site n'a **aucune image**. C'est ce qui lui manque le plus — tout le
reste (couleurs, typographie, structure, contrastes) est fait et mesuré.

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

## Ordre de priorité

| | Ce que ça débloque |
|---|---|
| 1. La pose chez un client | Le vide de l'écran d'accueil, et la preuve qu'on se déplace |
| 2. Le rafraîchisseur | La moitié de l'offre, aujourd'hui invisible |
| 3. Les vidéos clients | La preuve sociale — cinq emplacements vides attendent |
| 4. Le climatiseur | Complète la comparaison des deux machines |
| 5. Les captures | La crédibilité technique |
| 6. La camionnette | Confort |

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
