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

## 1b. LA BANDE — le nouveau gabarit, entre la promesse et « pour qui »

**Fichiers :** `photo-pose-900.jpg` / `-1600.jpg` / `-2400.jpg`
**Proportion :** 16:9 paysage, large (par exemple 2400 × 1350)

C'est le **même sujet que la photo n° 1** — un technicien qui pose le kit
chez un client — mais dans un cadrage large, parce qu'elle occupe toute la
largeur de l'écran.

**Où ça se branche :** une bande d'un bord à l'autre, glissée entre l'écran
qui promet « demain matin, quelqu'un sonne chez vous » et l'écran suivant.
C'est le seul geste large du site en dehors des blocs marine. Sur un site
entièrement fait de texte, c'est elle qui fera respirer la page.

**Le cadrage :** gardez de l'air en haut et en bas — la bande est haute de
380 px sur ordinateur et recadre par le milieu. Ce qui touche les bords
disparaîtra. Une légende se pose en bas à gauche, sur un voile sombre : ne
mettez rien d'important dans ce coin.

**Si vous n'avez qu'une photo à faire, faites celle-là.** Elle sert à deux
endroits : la bande, et l'emplacement portrait de l'accueil.

---

## 1c. LE PANNEAU ASSISTANCE — « une seule équipe »

**Fichiers :** `photo-equipe-800.jpg` / `-1200.jpg`
**Proportion :** portrait, un peu plus haut que large (par exemple 1200 × 1400)

**Le sujet :** vous, au téléphone, devant la camionnette ou devant une porte
d'immeuble. Pas une pose de photographe : quelqu'un qui travaille et qui
répond. C'est la photo qui prouve la phrase du bloc — celle qui répond au
téléphone est celle qui sonne à la porte.

**Où ça se branche :** à droite d'un bloc marine, juste avant les questions
fréquentes. Le texte est à gauche, la photo remplit la moitié droite sur
toute la hauteur du bloc.

**Le cadrage :** vertical, sujet plutôt au centre. Le bloc recadre par le
milieu et fait environ 400 px de large sur ordinateur : un plan large où
vous faites 5 % de l'image ne donnera rien.

**Tant que ce fichier n'existe pas**, le bloc se réorganise tout seul : les
trois moyens de nous joindre se mettent côte à côte sur toute la largeur.
Rien n'est cassé, rien n'est vide.

---

## 2b. LA photo de la page pro — en arrière-plan

**Fichiers :** `pro-rafraichisseurs-900.jpg` / `-1600.jpg` / `-2400.jpg`
**Proportion :** 16:9 paysage, large (par exemple 2400 × 1350)

**Ce qu'il faut dans le cadre :** **plusieurs rafraîchisseurs
professionnels ensemble** — alignés dans le local avant une livraison, ou
posés côte à côte chez un client. Le pluriel est le sujet de la photo : un
appareil seul dit « j'en ai un », plusieurs disent « j'équipe un site ».

**Où ça se branche :** elle devient le **fond de l'écran d'accueil pro**.
Le texte passe par-dessus, sur un voile marine. Ce n'est plus une vignette
dans un coin : c'est la page entière.

**Le cadrage compte plus que d'habitude**, parce que le texte se pose
dessus :

- Le texte occupe **la moitié gauche**. Gardez cette zone lisible — un mur,
  un sol, une porte de camion. Pas de détail important à gauche.
- Les appareils doivent être **à droite du cadre**, c'est là que le voile
  s'éclaircit et qu'on les voit.
- **Cadrez large.** L'image est recadrée en hauteur selon l'écran ; ce qui
  touche les bords peut disparaître.

**Vous n'avez pas à vous soucier de la luminosité.** Le voile est calculé
pour le pire cas : même une photo presque blanche laisse le titre à
11,6 pour 1 et le texte courant à 8,4 — très au-dessus de la norme. Une
photo claire, sombre, en plein soleil ou en intérieur : ça marchera.

**Surtout pas** la photo du climatiseur mobile. Cette page explique qu'un
climatiseur ne convient pas pour ces volumes ; le montrer contredirait le
texte en une seconde.

**En attendant :** l'écran garde exactement son apparence actuelle. Le
cadre en pointillés « photo à ajouter » a été retiré — il était visible
par les visiteurs et annonçait un chantier au lieu d'un service.

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
| 2b. Le fond de la page pro | L'écran d'accueil entier de l'offre entreprises |
| 3. Les vidéos clients | La preuve sociale — cinq emplacements vides attendent |
| 4. Le climatiseur | Complète la comparaison des deux machines |
| 5. Les captures | La crédibilité technique |
| 6. Les bandeaux de ville | Quatre pages qui ne montrent pas leur ville |
| 7. La camionnette | Confort |
| 8. Le logo et la police | L'identité — le reste marche sans, mais reste anonyme |

---

## Une règle à connaître : les paires, c'est tout ou rien

Les deux machines de l'écran « Le matériel » sont présentées côte à côte.
Testé avec une seule des deux photos en place : la carte qui en a une
descend de 206 px, l'autre reste en haut, et l'écran part de travers.

Le site refuse donc d'afficher une photo de paire toute seule. **Tant que
les deux ne sont pas là, aucune ne s'affiche** ; le jour où la seconde
arrive, les deux apparaissent ensemble. Ne vous étonnez pas si vous déposez
la photo du climatiseur et que rien ne change : il manque celle du
rafraîchisseur.

---

## Comment les images sont traitées

Pour que vos photos aient l'air d'appartenir à la marque plutôt que d'y
être collées, trois règles, et pas une de plus :

- **Un filet d'un pixel** à l'intérieur du bord, jamais une ombre portée.
  Il est invisible sur une photo sombre et sauve le bord d'une photo claire,
  qui sans lui se dissout dans le blanc de la page.
- **Le même arrondi que les cartes** — un seul rayon dans toute la page.
- **Un fond gris pendant le chargement**, pour qu'aucune case ne clignote
  en blanc.

Aucun cadre coloré, aucun effet, aucune ombre : ce qui fait tenir une image
sur ce site, c'est le vide autour d'elle.

Une **légende** est possible sous chaque photo. Elle reprend la goutte de la
marque en guise de marqueur — le même signe que les puces des guides et que
l'apostrophe du nom. Elle n'est jamais obligatoire.

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
