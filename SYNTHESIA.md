# Claude ↔ Synthesia

*Fabriquer des vidéos avec un présentateur IA, à partir d'un texte, sans
caméra et sans acteur.*

Synthesia prend un texte, et rend une vidéo où quelqu'un le dit à l'écran.
Ce fichier explique comment Claude s'en sert, et les deux choses qu'il faut
faire de votre côté pour que ça marche.

---

## 1. Ce qui est branché

Deux fichiers, ajoutés au dépôt :

- `api/_lib/synthesia.js` — la connexion elle-même. Elle sait créer une
  vidéo, suivre sa fabrication, lister les avatars du compte. Elle est
  rangée avec les autres connexions du site (Brevo pour les mails, Stripe
  pour les paiements), donc une page de l'admin pourra s'en servir plus
  tard sans rien réécrire.
- `synthesia-generateur.js` — l'outil qu'on lance à la main, comme les
  générateurs de blog et de pages de ville. C'est celui-là que Claude
  utilise quand vous demandez une vidéo.

Rien n'a changé sur le site. Aucune page, aucun bouton, aucun visiteur ne
voit quoi que ce soit. Tant que la clé n'est pas là, ces deux fichiers ne
font rien.

---

## 2. Les deux choses à faire de votre côté

### a) La clé Synthesia

Sur Synthesia : **Settings → Integrations → API**, puis créer une clé et la
copier. Attention : l'API n'est pas incluse dans tous les forfaits — s'il
n'y a pas d'onglet API, c'est que le forfait ne la donne pas encore.

Ensuite, coller cette clé à **un** de ces deux endroits :

- **Pour que Claude s'en serve** : dans un fichier `.env` à la racine du
  dépôt, une seule ligne :

      SYNTHESIA_API_KEY=votre-clé-ici

  Ce fichier est ignoré par Git (il ne partira jamais sur GitHub).

- **Pour que le site s'en serve un jour** (pas encore le cas) : dans
  Vercel → Settings → Environment Variables, même nom `SYNTHESIA_API_KEY`.

### b) Autoriser Synthesia dans les sessions Claude

Les sessions Claude tournent dans une boîte fermée : elles ne peuvent
appeler que les sites explicitement autorisés. Aujourd'hui Synthesia n'y
est pas, et l'appel est refusé avec ce message :

    Host not in allowlist: api.synthesia.io

Il faut donc ajouter **`api.synthesia.io`** aux réglages réseau de
l'environnement Claude (les *network egress settings* de l'environnement,
dans les réglages de Claude Code sur le web). Sans ça, tout le reste est
prêt mais l'appel n'arrive jamais jusqu'à Synthesia.

---

## 3. Comment demander une vidéo

Une fois les deux points ci-dessus faits, il suffit de le dire en français,
par exemple :

> « Fais-moi une vidéo verticale de 20 secondes qui explique comment ouvrir
> le boxe, et enregistre-la dans `videos/tuto-boxe.mp4`. »

Claude écrit le texte, lance la fabrication, attend, et récupère le fichier.

Les commandes qu'il lance, si vous voulez les lancer vous-même :

    node synthesia-generateur.js avatars
        La liste des présentateurs disponibles, avec leur identifiant.

    node synthesia-generateur.js creer --titre "Ouvrir le boxe" \
         --fichier script.txt --format 9:16 --attendre --sortie videos/tuto-boxe.mp4

    node synthesia-generateur.js statut <identifiant> --attendre

    node synthesia-generateur.js liste

`--format 9:16` = vertical (téléphone, story). `16:9` = horizontal, c'est le
défaut.

---

## 4. Essai ou vrai crédit

**Par défaut, toute vidéo est fabriquée en mode essai** : gratuite, mais
avec un filigrane en travers de l'image. C'est fait exprès — on ne dépense
pas un crédit pour se rendre compte que le texte était à revoir.

Pour la version finale, sans filigrane, il faut ajouter `--reel`. Là un
crédit du forfait est consommé. Claude ne le fera jamais sans que vous le
demandiez.

Choisir le présentateur : `node synthesia-generateur.js avatars` donne la
liste. Pour en fixer un par défaut, ajouter dans `.env` :

    SYNTHESIA_AVATAR_ID=identifiant-copié-depuis-synthesia
    SYNTHESIA_BACKGROUND=off_white

---

## 5. À quoi ça sert vraiment ici

**Les tutoriels transporteurs — oui.** L'admin a déjà une bibliothèque de
vidéos par catégorie (ouvrir le boxe, chargement, installation…) et
plusieurs emplacements attendent leur vidéo. Ces vidéos-là expliquent un
geste : un présentateur qui parle par-dessus des consignes fait le travail,
et se refait en trente secondes quand la consigne change.

**Les cinq témoignages clients de l'accueil — non.** `VISUELS.md` demande
cinq vrais clients filmés au téléphone, et la page dit « pas d'acteurs, pas
de studio ». Y mettre un présentateur IA se voit tout de suite et casse
exactement l'argument que la page défend. C'est mon avis, vous décidez —
mais si c'est ça que vous voulez, dites-le explicitement.

---

## 6. Ce qui n'a pas pu être testé

La session qui a écrit ce code n'a **pas** de clé Synthesia et n'a **pas**
le droit d'appeler `api.synthesia.io` (point 2b). Le code a été vérifié
jusqu'à la porte : la requête part bien, correctement formée, et c'est le
pare-feu qui la refuse. La première vraie vidéo servira donc aussi de test.

Si un message d'erreur revient de Synthesia (avatar inconnu, fond
inexistant, plus de crédits), il est affiché tel quel, en entier : c'est
suffisant pour corriger en une ligne.
