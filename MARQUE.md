# La marque Loc'Air

Ce fichier est la référence. Tout ce qui suit est **relevé dans le code**,
pas décidé ici : chaque couleur, chaque taille, chaque contraste a été mesuré
sur le site tel qu'il tourne aujourd'hui.

Il existe pour une raison simple : jusqu'ici, les règles de la marque vivaient
dans les commentaires de `locair.css`. Personne ne pouvait les appliquer sans
lire 3 000 lignes de style. Maintenant elles tiennent sur une page.

**Où vivent les valeurs pour de vrai :** en haut de `locair.css`, dans le bloc
`:root{}`. Ce fichier-ci les explique, il ne les remplace pas. Si une valeur
change là-bas, elle change ici aussi.

---

## 1. Le nom

Ça s'écrit **Loc'Air**. Toujours. Une majuscule à `L`, une à `A`, une
apostrophe entre les deux. Jamais « LocAir », jamais « LOC'AIR » dans une
phrase, jamais « Loc Air ».

### La goutte

L'apostrophe n'est pas une apostrophe : c'est **une goutte d'eau dorée**.
C'est la seule signature graphique de la marque. Elle rappelle l'eau et le
froid — ce que Loc'Air vend.

En code :

```html
<a class="logo" href="/">Loc<i class="gt">'</i>Air</a>
```

La forme est faite de trois coins ronds et d'un coin pointu, penchée à -25° :
la pointe part vers le bas-gauche, exactement le geste d'une apostrophe.

```css
.gt::before{
  width:.30em; height:.30em;
  background:var(--gold-txt);              /* sur fond clair */
  border-radius:50% 50% 50% 0;
  transform:rotate(-25deg);
}
.bar .gt::before, .sur-fonce .gt::before{background:var(--gold)}  /* sur fond sombre */
```

Deux ors, et ce n'est pas une erreur : sur fond clair la goutte prend l'or
foncé (`--gold-txt`), sinon elle serait illisible. Voir la règle de l'or.

**La même goutte sert de puce** dans les listes et de marqueur de légende
sous les photos. C'est le seul motif de la maison : on ne lui en ajoute pas
d'autre.

---

## 2. Les couleurs

| Jeton | Valeur | À quoi ça sert |
|---|---|---|
| `--ink` | `#0E1F35` | Le marine. Les textes, les écrans sombres. |
| `--ink-2` | `#57687C` | Texte secondaire. |
| `--ink-3` | `#5F6E80` | Texte discret, légendes. |
| `--vif` | `#086E60` | **Le sarcelle. La couleur d'action** : boutons, liens, chiffres. |
| `--vif-d` | `#065A4E` | Le sarcelle au survol. |
| `--vif-clair` | `#E7F3F0` | Le sarcelle en fond très pâle. |
| `--gold` | `#C9A227` | L'accent. **Fond sombre uniquement.** |
| `--gold-txt` | `#7A6313` | Le même or, assombri pour fond clair. |
| `--paper` | `#FFFFFF` | Le blanc. |
| `--mist` | `#F5F7FA` | Le gris très pâle des écrans alternés. |
| `--line` | `#E6EBF1` | Les filets et les bordures. |
| `--green` | `#0F7A3D` | Réservé aux confirmations (« payé », « livré »). |
| `--alerte` | `#B8860B` | Réservé aux avertissements. |

Le sarcelle et l'or ne se disputent jamais la même place : **le sarcelle
agit** (on clique dessus), **l'or souligne** (on le regarde).

---

## 3. LA règle de l'or

> **L'or ne se pose que sur fond sombre.**

Ce n'est pas une question de goût, c'est une question de lisibilité. Mesuré :

| L'or `#C9A227` sur… | Contraste | Verdict |
|---|---|---|
| Blanc | **2,42** | ✗ très en dessous de la norme (4,5) |
| Sarcelle `#086E60` | **2,55** | ✗ |
| Marine `#0E1F35` | **6,86** | ✓ largement au-dessus |

Sur fond clair, on utilise `--gold-txt` `#7A6313` : **5,80** sur blanc. ✓

C'est la règle la plus facile à casser sans s'en rendre compte, parce qu'à
l'écran l'or clair sur blanc a l'air « juste un peu pâle ». Il est illisible.

---

## 4. Les contrastes mesurés

À garder sous la main. La norme est **4,5** pour du texte courant, **3,0**
pour du gros texte et pour les anneaux de focus au clavier.

| | sur blanc | sur marine | sur sarcelle |
|---|---|---|---|
| `--ink` `#0E1F35` | 16,59 ✓ | — | 2,69 ✗ |
| `--ink-2` `#57687C` | 5,71 ✓ | 2,90 ✗ | 1,08 ✗ |
| `--ink-3` `#5F6E80` | 5,21 ✓ | 3,18 ✗ | 1,18 ✗ |
| `--vif` `#086E60` | 6,16 ✓ | 2,69 ✗ | — |
| `--gold` `#C9A227` | 2,42 ✗ | **6,86 ✓** | 2,55 ✗ |
| `--gold-txt` `#7A6313` | 5,80 ✓ | 2,86 ✗ | 1,06 ✗ |
| Blanc | — | **16,59 ✓** | **6,16 ✓** |

`--ink-3` sur la brume `#F5F7FA` : **4,86** ✓ — ça passe, mais de peu. Ne pas
l'éclaircir.

---

## 5. Les trois fonds

Un écran a l'un de ces trois sols, et jamais autre chose :

```css
.e-ink { background:#0E1F35; color:#FFFFFF }   /* marine  — les moments forts */
.e-blue{ background:#086E60; color:#FFFFFF }   /* sarcelle — les garanties    */
.e-mist{ background:#F5F7FA }                  /* brume   — respiration       */
```

Sans classe, l'écran est blanc. On alterne pour que la page respire — deux
écrans sombres à la suite, ça pèse.

Sur fond sombre, **le bouton principal passe en blanc** : un bouton sarcelle
sur un fond sarcelle disparaît.

---

## 6. Les polices

| Rôle | Police | Poids | D'où elle vient |
|---|---|---|---|
| Titres | **Bricolage Grotesque** | 700 | hébergée chez nous, `/polices/` |
| Tout le reste | **DM Sans** | 400 · 500 · 700 | Google Fonts |

```css
--font-titre: 'Bricolage', var(--font);
--font: 'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
```

Bricolage est hébergée chez nous et découpée en deux fichiers (latin et
latin étendu) : la page ne télécharge que ce dont elle a besoin, et si Google
Fonts tombe, les titres tiennent quand même.

**Aucune troisième police.** Jamais.

---

## 7. Les tailles

### Les titres — ils grandissent avec l'écran

| Jeton | Valeur | Pour quoi |
|---|---|---|
| `--t-1` | `clamp(38px, 7.4vw, 86px)` | le titre d'accueil |
| `--t-2` | `clamp(33px, 5vw, 60px)` | les titres d'écran |
| `--t-3` | `clamp(29px, 4.2vw, 50px)` | |
| `--t-4` | `clamp(26px, 3.5vw, 42px)` | |
| `--t-5` | `clamp(22px, 2.4vw, 29px)` | les sous-titres |
| `--t-6` | `clamp(18px, 2.1vw, 23px)` | |

### Les textes — taille fixe

`--s-1` 11,5 px · `--s-2` 13 · `--s-3` 14,5 · `--s-4` 16 · `--s-5` 17,5 ·
`--s-6` 19,5 · `--s-7` 23.

`--s-1` est réservé aux surtitres en capitales espacées. En dessous de 11,5 px,
rien.

### Les espaces entre les blocs

`--e-1` `clamp(22px, 2.4vw, 32px)` · `--e-2` `clamp(24px, 2.9vw, 40px)` ·
`--e-3` `clamp(28px, 3.8vw, 52px)` · `--e-4` `clamp(30px, 4.8vw, 64px)`

### La largeur de lecture

`--lire: 34ch`. Un paragraphe ne dépasse jamais cette largeur : au-delà, l'œil
perd la ligne en revenant à la gauche.

`--max: 1000px` (1180 sur très grand écran) · `--pad: 24px` sur les côtés.

---

## 8. Les formes et le mouvement

**Arrondis** — `--r-s` 8px · `--r` 12px · `--r-l` 20px · `--r-f` 100px (les
boutons en gélule). Un seul arrondi par famille d'élément dans un même écran.

**Ombres** — `--o-1` (à peine), `--o-2` (cartes), `--o-3` (ce qui flotte).
Toutes teintées de marine, jamais de noir pur : une ombre noire sur un fond
bleuté a l'air sale.

**Mouvement** — `--mv-1` 0,14 s (réaction immédiate : survol, couleur) ·
`--mv-2` 0,24 s (déplacement : panneau, menu) · `--mv-3` 0,68 s (apparition au
défilement) · `--mv-ar` 0,42 s (l'arrivée du haut de page).

La courbe est toujours `--mv: cubic-bezier(.32,.72,.28,1)`.

**Deux règles qui ne se discutent pas :**

1. On ne détourne **jamais** le défilement. On le lit, on ne le pilote pas.
2. Tout ce qui bouge doit s'arrêter pour qui a réglé son appareil sur
   « moins d'animations » (`prefers-reduced-motion`). Et la page doit rester
   entière et lisible sans le moindre mouvement.

---

## 9. Le ton

**On explique simplement.** Comme à quelqu'un qui n'y connaît rien. Phrases
courtes, mots concrets, pas de jargon.

**On vend le résultat, pas la machine.** Personne ne loue un climatiseur : on
loue une nuit où l'on dort. Le titre d'accueil dit « Cette nuit, vous
dormez », pas « Climatiseurs mobiles disponibles ».

**On ne promet que ce qui est vrai à la seconde où on l'écrit.** Le titre
d'accueil a trois versions selon l'heure et le stock — avant 18 h avec du
stock, après 18 h, complet — parce qu'un titre ne doit jamais promettre ce que
la ligne d'en dessous dément.

**On ne fabrique jamais** un chiffre, un modèle, une date, un prix, un avis,
une photo ou une promesse. Tout ce qui est écrit doit être vérifiable ailleurs
dans le site ou dans le code.

**Un texte de remplacement décrit ce qu'on voit.** Pas ce qu'on aimerait
montrer. Une photo d'une machine seule ne s'annonce pas comme « installée dans
un salon ».

---

## 10. Les quatre langues

Le site parle **français, anglais, chinois et russe**. Toujours les quatre.

Un texte ne s'écrit jamais en dur : il porte une clé (`data-t`, `data-th`,
`data-tp`, `data-ta`, `data-talt`) et vit dans le dictionnaire, en quatre
versions.

`python3 audit-i18n.py` doit afficher **100 %** et **« HTML et dictionnaire :
identiques »**. Sinon la modification n'est pas finie.

Les noms de communes restent en français dans toutes les langues : Nice,
Villefranche-sur-Mer, Menton ne se traduisent pas.

**Les capitales se posent en CSS**, jamais dans le dictionnaire : le chinois
n'a pas de casse, et un lecteur d'écran ne doit pas épeler des majuscules
écrites à la main.

---

## 11. Les images

**Aucune photo d'agence. Jamais.** Une photo achetée dans une banque d'images
dit au visiteur qu'on n'a rien à lui montrer de vrai.

Tant qu'une vraie photo n'existe pas, on met **un dessin au trait** — qui ne
prétend rien, qu'on reconnaît tout de suite pour un schéma, et qui **s'efface
tout seul** le jour où la photo arrive (`:has()` s'en charge).

Le trait du dessin suit la couleur du texte, donc il marche sur fond clair
comme sur fond marine.

Quand une photo arrive : `width` et `height` écrits dans la balise (sinon la
page saute), WebP en premier avec le JPEG derrière, et trois tailles.

Le brief des photos qui manquent est dans `VISUELS.md`.

---

## 12. Où on en est : il y a deux marques

C'est l'état réel, mesuré sur les 27 pages publiques.

| | **Ancienne** (13 pages) | **Nouvelle** (14 pages) |
|---|---|---|
| Titres | Cormorant Garamond | Bricolage Grotesque |
| Textes | Inter | DM Sans |
| Marine | `#1a2b4a` | `#0E1F35` |
| Or | `#c5a96c` | `#C9A227` |
| Action | `#16a34a` | `#086E60` |
| Style | 3 828 lignes dans la page | `locair.css` partagé |
| La goutte | absente | présente |

**Ancienne :** `index.html`, cgv, mentions-legales, confidentialite, madrid,
madrid-en, reunion, 404, prolongation, retard, nouvelle-version.

**Nouvelle :** version-b, pro, les 5 pages de ville, les 7 articles de blog.

Le vert de l'ancienne, `#16a34a`, n'est pas une couleur choisie : c'est le vert
par défaut d'une bibliothèque de code. Son contraste sur blanc est **3,3** —
sous la norme pour du texte. Le sarcelle maison est à **6,16**.

**Ce qu'il reste à faire, dans l'ordre :**

1. Les six pages de service et légales (cgv, mentions-legales, confidentialite,
   404, prolongation, retard). Presque pas de mise en page, et ce sont celles
   qu'on lit **juste avant de payer**.
2. Les deux images de partage. `locair.fr` et Madrid envoient la photo,
   tout le reste envoie la carte au logo. Il en faut une seule.
3. `index.html`. La plus grosse, celle qui porte tout le trafic — et celle que
   ce dépôt interdit de modifier sans décision explicite du propriétaire.

---

## 13. Ce qu'on ne fait jamais

- De l'or sur fond clair.
- Une photo d'agence.
- Un chiffre, un avis, un modèle ou une date qu'on ne peut pas prouver.
- Une troisième police.
- Un texte écrit en dur, hors du dictionnaire.
- Détourner le défilement.
- Une animation qu'on ne peut pas couper.
- Toucher `index.html` sans que le propriétaire l'ait demandé.

---

## 14. Vérifier avant de publier

```bash
python3 audit-i18n.py              # 100 %, 4 langues, HTML = dictionnaire
python3 audit-i18n.py pro.html     # pareil
python3 audit-seo.py               # titres et descriptions uniques
```

Puis, dans un navigateur : aucun texte sous la norme de contraste, aucun
anneau de focus sous 3:1, aucun débordement horizontal de 320 à 1900 px,
aucune erreur JavaScript.
