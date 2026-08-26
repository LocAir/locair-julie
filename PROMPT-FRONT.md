# Deux prompts pour le front end de Loc'Air

Ce fichier contient deux versions du même travail.

- **A** — le prompt court, à coller pour une session de travail normale.
- **B** — le prompt long, prêt pour `/loop`, qui découpe le travail en tours
  et impose la discipline de mesure et de non-régression.

Les deux s'appuient sur l'état réel du dépôt au 26 août 2026. Si des mois
passent, remesurer avant de réutiliser : les chiffres cités doivent rester
vrais, sinon le prompt fait travailler sur un fantôme.

---

## A — LE PROMPT COURT

```
Améliore le front end de Loc'Air à tous les niveaux — pas seulement ce que
ça donne en photo, mais ce que ça donne quand on s'en sert.

ÉTAT MESURÉ AUJOURD'HUI
29 pages publiques, locair.css fait 2 686 lignes, index.html 813 ko,
version-b.html 260 ko, pro.html 199 ko, 92 fonctions dans /api.
Il existe 8 fichiers image en tout, dont une seule vraie photo de produit
(hero-clim.jpg). version-b.html a 5 emplacements photo, tous masqués.
Tout est en HTML/CSS/JS à la main, sans framework, déployé sur Vercel.
Supabase derrière, Stripe pour le paiement, Brevo pour les messages.

CE QUE J'APPELLE « TOUS LES NIVEAUX » — SIX NIVEAUX, DANS CET ORDRE
1. LE PREMIER COUP D'ŒIL. Ce qu'on voit avant de lire : hiérarchie, densité,
   respiration, l'arrivée de la page. Est-ce que ça a l'air tenu par un pro ?
2. LA LECTURE. Échelle typographique, longueur de ligne, veuves et orphelines,
   césures, chiffres alignés en colonne, contraste.
3. LES ÉTATS. Chaque chose cliquable a six états : repos, survol, focus clavier,
   appui, désactivé, chargement. Et chaque zone qui affiche des données en a
   trois de plus : vide, en erreur, en cours. La plupart manquent.
4. LE GESTE. Sur téléphone : zones de touche d'au moins 44 px, barre du bas,
   clavier qui monte sans cacher le champ, encoche et barre système respectées.
5. LE MOUVEMENT. Une seule grammaire : deux durées, une courbe, et rien qui
   bouge pour qui a demandé moins d'animation. Jamais de défilement détourné.
6. LE SYSTÈME. Les valeurs en dur remontent dans les jetons --t-*, --s-*, --e-*.
   Le CSS mort part. Deux composants qui font la même chose fusionnent.

RÈGLES DURES
- Ne JAMAIS toucher index.html.
- Ne JAMAIS inventer une photo, un avis, un chiffre, un modèle, une date ou une
  promesse. Tout ce qui s'écrit doit déjà être vrai ailleurs dans le dépôt.
  Si une donnée manque, la demander — ne pas la combler.
- Aucune photo de banque. S'il faut une image, la DESSINER en SVG au trait,
  dans la palette maison, et qu'elle s'efface toute seule le jour où la vraie
  photo arrive.
- Chaque texte modifié l'est dans le HTML ET dans le dictionnaire, dans les
  QUATRE langues (fr, en, zh, ru).
- Une modification de schéma SQL ne prend jamais effet toute seule : prévenir
  et donner le SQL exact à coller dans Supabase avant de merger.

MÉTHODE
Mesurer avant. Corriger. Mesurer après. Montrer les deux chiffres.
Un changement à la fois, vérifié, puis le suivant. Pas de grand soir.

NON-RÉGRESSION, À CHAQUE FOIS
- python3 audit-i18n.py : 100 %, 4 langues, HTML = dictionnaire, 0 entité HTML
- audit-contraste.html sur fr / ru / zh + /pro : aucun texte sous la norme,
  aucun anneau de focus sous 3:1
- 0 erreur JS, 0 débordement horizontal de 320 à 1900 px
- calculateur à 294 €, cartes de tarif à 144 / 214 / 349 €, 18 écrans et
  18 points de navigation, pied de page et signature présents

Expliquer simplement, comme à un ado qui n'y connaît rien.
```

---

## B — LE PROMPT LONG, POUR `/loop`

À coller après `/loop ` (sans intervalle : le rythme est décidé tour par tour).

```
Rendre le front end de Loc'Air irréprochable à tous les niveaux — pas la photo
du site, l'usage du site. Un tour = UN élément, mesuré avant et après, vérifié,
commité, poussé, mergé. Puis le suivant.

═══ ÉTAT MESURÉ AU DÉPART (26 août 2026) ═══
29 pages publiques. locair.css : 2 686 lignes. index.html : 813 ko.
version-b.html : 260 ko, 18 écrans, 18 points. pro.html : 199 ko.
92 fonctions dans /api. 8 fichiers image au total, dont UNE seule vraie photo
de produit (hero-clim.jpg). version-b.html : 5 emplacements photo, tous masqués,
0 image réellement visible, 0 vidéo. Vanilla HTML/CSS/JS, Vercel, Supabase,
Stripe, Brevo. Traduction par dictionnaire global T + attributs data-t/th/tp/ta.

La page est techniquement irréprochable et visuellement pauvre. Aucune photo
n'existe et je ne peux pas en fabriquer honnêtement. Donc : combler par du
DESSIN vrai et par du soin d'usage, jamais par de la fausse photo.

═══ LA LISTE, DANS L'ORDRE ═══

(1) LE PREMIER AFFICHAGE. La page arrive figée : aucun moment d'arrivée n'a été
    pensé. Travailler l'entrée du haut de page — le titre, le sous-titre, le
    bouton, le bandeau vivant — sans JAMAIS détourner le défilement, sans faire
    clignoter le contenu si le JavaScript ne part pas, et sans rien bouger pour
    qui a réglé son téléphone sur « moins d'animation ». Mesurer le décalage de
    mise en page avant et après : il doit rester à zéro.

(2) LES SIX ÉTATS DE CHAQUE CHOSE CLIQUABLE. Passer en revue boutons, liens,
    cartes, onglets, points de navigation, champs : repos, survol, focus
    clavier, appui, désactivé, chargement. Lister ce qui manque, puis combler.
    L'anneau de focus doit se voir sur SON fond — un anneau sarcelle sur du
    marine était à 2,77:1, c'est ce genre de trou qu'on cherche.

(3) LES TROIS ÉTATS DE CHAQUE ZONE DE DONNÉES. Le carrousel d'avis, le bandeau
    vivant, le stock du jour, la météo : que voit-on quand c'est vide, quand
    c'est en erreur, quand ça charge ? Aujourd'hui la plupart se cachent en
    silence. Un bloc qui disparaît sans explication use la confiance.

(4) LE TÉLÉPHONE D'ABORD. Zones de touche d'au moins 44 px, barre du bas qui ne
    couvre rien d'important, clavier qui monte sans cacher le champ actif,
    encoche et barre système (safe-area), 100svh et jamais 100vh. Mesurer sur
    320, 360, 390 et 414 px.

(5) LES FORMULAIRES. Le vrai endroit où on gagne ou on perd une réservation :
    autocomplete et inputmode corrects sur chaque champ, validation à la sortie
    du champ et pas à la frappe, messages d'erreur qui disent quoi corriger et
    comment, jamais « champ invalide ». Le bouton passe en état chargement
    pendant l'appel réseau et ne peut pas être cliqué deux fois.

(6) LA VITESSE RESSENTIE. Toute image a sa largeur et sa hauteur écrites, tout
    bloc qui se remplit plus tard réserve sa place, rien ne saute. Mesurer le
    poids et le nombre de requêtes avant/après. Ne pas casser la lisibilité pour
    gagner 3 ko.

(7) LE CLAVIER ET LE LECTEUR D'ÉCRAN. Ordre de tabulation, lien d'évitement,
    pièges de focus dans les fenêtres modales, annonces live quand un prix
    change. Faire le parcours complet de réservation au clavier seul et écrire
    ce qui bloque.

(8) LES PAGES SECONDAIRES. /pro, /client, les quatre pages villes, /reunion,
    /404 n'ont pas reçu le même soin que l'accueil. Les passer une par une avec
    la même grille que ci-dessus.

(9) LE MOUVEMENT, UNE SEULE GRAMMAIRE. Recenser toutes les durées et courbes
    utilisées, les ramener à deux durées et une courbe posées dans les jetons,
    et vérifier que « moins d'animation » coupe bien tout.

(10) LE SYSTÈME. Sortir les valeurs en dur vers --t-*, --s-*, --e-*, --vif,
     --ink. Supprimer le CSS mort. Fusionner deux composants qui font la même
     chose. Chaque suppression est prouvée par une mesure, pas supposée.

(11) LA COHÉRENCE DU TEXTE — NE RIEN DÉCIDER SEUL, DEMANDER.
     Trois incohérences connues, chacune touche les quatre langues :
     · le site dit « demain matin » 15 fois dans version-b et 8 fois dans
       index, alors que le standard annoncé au téléphone est « aujourd'hui
       sous 2h » ;
     · Genève est encore annoncée « en préparation » (2 fois dans version-b,
       1 fois dans pro) alors que la ville a été abandonnée ;
     · le site affiche « 32 avis » 20 fois, un autre document parle de 37.
     Poser les trois questions au propriétaire, attendre la réponse, PUIS
     corriger partout d'un coup.

═══ RÈGLES DURES ═══
- Ne JAMAIS toucher index.html.
- Ne JAMAIS fabriquer une photo, un avis, un chiffre, un modèle, une date ou
  une promesse. Tout ce qui s'écrit doit déjà être vrai ailleurs dans le dépôt.
  Une donnée qui manque se demande, elle ne se comble pas.
- Aucune photo de banque, jamais. S'il faut une image : la DESSINER en SVG au
  trait, dans la palette maison, lisible sur fond clair ET sur fond marine, et
  qui s'efface toute seule le jour où la vraie photo arrive.
- Tout texte modifié l'est dans le HTML ET dans le dictionnaire, en fr, en, zh
  et ru. Les noms de communes de la zone de livraison ne se traduisent pas :
  ce sont des adresses.
- Une modification de schéma SQL ne prend jamais effet toute seule : prévenir
  explicitement et donner le SQL exact à coller dans Supabase avant de merger.
- Ne pas élargir le chantier tout seul. Un tour = un élément.

═══ LA DISCIPLINE, À CHAQUE TOUR ═══
1. MESURER l'état de départ et l'écrire noir sur blanc.
2. CORRIGER un seul élément.
3. MESURER de nouveau et comparer les deux chiffres.
4. NON-RÉGRESSION COMPLÈTE :
   · python3 audit-i18n.py — 100 %, 4 langues, HTML = dictionnaire, 0 entité
   · audit-contraste.html sur fr / ru / zh + /pro — aucun texte sous la norme,
     aucun anneau de focus sous 3:1
   · 0 erreur JS et 0 débordement horizontal sur 320, 360, 390, 414, 480, 600,
     768, 820, 1024, 1180, 1280, 1440, 1600 et 1900 px
   · calculateur à 294 €, cartes de tarif à 144 / 214 / 349 €
   · 18 écrans et 18 points de navigation, pied de page et signature présents
5. COMMITER avec un message qui dit le problème, la correction et la mesure.
6. POUSSER sur claude/lovable-control-from-claude-u4lryr, ouvrir la PR,
   attendre Vercel, MERGER vers main sans demander.
7. Repartir de la branche à jour avant le tour suivant.

═══ QUAND S'ARRÊTER ═══
Quand les onze points sont faits, ou quand le tour suivant ne peut plus rien
améliorer sans une décision du propriétaire ou une vraie photo. Le dire
clairement plutôt que de tourner à vide.

Expliquer simplement, comme à un ado qui n'y connaît rien en technique.
```
