# Référencement local — état des lieux et correctifs

Mesuré par `audit-seo.py` (à la racine du dépôt). À relancer après chaque
changement : `python3 audit-seo.py`.

---

## ⚠️ À FAIRE À LA MAIN DANS `index.html`

Je n'ai pas le droit de toucher `index.html`, et c'est pourtant là que se
trouve le défaut le plus grave. Voici le correctif exact.

### Le problème

La page d'accueil — celle que Google regarde en premier — **ne déclare
aucune adresse**. Toutes les autres pages déclarent « 11 Avenue Chantal,
06100 Nice ». L'accueil, lui, dit :

```json
"address": { "@type":"PostalAddress", "streetAddress":"", "addressLocality":"France", "postalCode":"", "addressCountry":"FR" }
```

Et il déclare servir la France entière :

```json
"areaServed": [ { "@type":"Country", "name":"France" } ]
```

Pour un commerce local, l'adresse est **le** signal. Google la compare à
celle de la fiche Google Business. Si le site n'en déclare aucune, il n'y a
rien à comparer. Et annoncer « la France » quand on livre à Nice dilue le
signal au lieu de l'affirmer : autant dire à Google qu'on n'est de nulle part.

### Le correctif

Dans `index.html`, ligne ~106, dans le `<script id="schema-ld">`.

**Remplacer**

```json
"address":{"@type":"PostalAddress","streetAddress":"","addressLocality":"France","postalCode":"","addressCountry":"FR"}
```

**par**

```json
"address":{"@type":"PostalAddress","streetAddress":"11 Avenue Chantal","addressLocality":"Nice","postalCode":"06100","addressCountry":"FR"}
```

**Puis remplacer**

```json
"areaServed":[{"@type":"Country","name":"France"}]
```

**par**

```json
"areaServed":[{"@type":"City","name":"Nice"},{"@type":"City","name":"Saint-Laurent-du-Var"},{"@type":"City","name":"Cagnes-sur-Mer"},{"@type":"City","name":"Villefranche-sur-Mer"},{"@type":"City","name":"Beaulieu-sur-Mer"},{"@type":"City","name":"Cannes"},{"@type":"City","name":"Antibes"},{"@type":"City","name":"Monaco"},{"@type":"City","name":"Menton"}]
```

Ces neuf villes sont exactement celles déjà annoncées sur l'écran « Zone de
livraison ». Rien d'inventé.

Le même `areaServed:"France"` apparaît une deuxième fois dans le bloc
`Service` de la même page : le remplacer pareil.

### 3. L'image de partage est une photo verticale

`index.html` déclare, deux fois (Open Graph et Twitter) :

```html
<meta property="og:image" content="https://www.locair.fr/hero-clim.jpg"/>
```

`hero-clim.jpg` fait **1400 × 2100** — une photo debout. Facebook, LinkedIn,
WhatsApp et X affichent l'aperçu dans un cadre **couché** de 1200 × 630.
Résultat : les deux tiers de la photo sont jetés, et ce qui reste est
recadré au hasard par la plateforme, pas par vous.

Le site a déjà une carte de partage faite pour ça : `og-locair.png`, en
1200 × 630. C'est celle que toutes les autres pages utilisent.

**À remplacer dans `index.html`** (les deux occurrences, `og:image` et
`twitter:image`) :

```html
<meta property="og:image" content="https://www.locair.fr/og-locair.png"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:image:alt" content="Loc'Air — le froid, à l'heure."/>
```

Attention : `hero-clim.jpg` est aussi affichée **dans** la page, à quatre
endroits. Ces quatre-là, on n'y touche pas — seules les balises d'aperçu
changent.

`madrid.html`, `madrid-en.html` et `reunion.html` avaient exactement le même
défaut : c'est corrigé. `reunion.html` allait plus loin, elle annonçait
elle-même `og:image:width 1400` et `og:image:height 2100` dans un cadre
couché.

### Comment vérifier après

1. Coller les deux remplacements, déployer.
2. Relancer `python3 audit-seo.py` : les deux lignes CRITIQUE doivent
   disparaître.
3. Passer l'URL dans le test des résultats enrichis de Google
   (search.google.com/test/rich-results) — il doit lire l'adresse complète.

---

## Ce que je peux corriger moi-même

| # | Défaut | Gravité | État |
|---|---|---|---|
| 1 | ~~Aucune page dédiée à **Nice**~~ | CRITIQUE | **✅ fait** — `/location-climatiseur-nice`, dans le sitemap, 5 liens internes |
| 2 | `madrid.html` et `reunion.html` ont **la même description** — Google en ignore une. | IMPORTANT | à faire |
| 3 | **7 titres dépassent 60 caractères** et 8 descriptions dépassent 160 : Google les coupe au milieu. | IMPORTANT | à faire |
| 4 | Les pages villes n'ont **aucun `hreflang`** alors que le site existe en 4 langues. | IMPORTANT | à faire |
| 5 | ~~`madrid`, `madrid-en` et `reunion` envoient une **photo verticale 1400×2100** dans le cadre couché 1200×630 des réseaux sociaux~~ | IMPORTANT | **✅ fait** — les trois pointent vers `og-locair.png`. Reste `index.html`, voir plus haut. |

---

## Une décision qui vous revient

`robots.txt` **bloque `/pro.html`** aux moteurs. Cette page porte pourtant
une vraie fiche commerciale (LocalBusiness, tarifs, zone servie). Tant
qu'elle est bloquée, l'offre entreprises est invisible sur Google : personne
ne peut trouver « location rafraîchisseur adiabatique entreprise Nice » et
tomber dessus.

C'est peut-être voulu — une page qu'on ne montre qu'aux prospects qu'on
appelle. Dites-moi : si vous voulez qu'elle se référence, il suffit de
retirer une ligne.

---

## Ce qui est déjà bon

- Un seul numéro de téléphone déclaré sur tout le site : `+33663798756`.
- Toutes les URL du sitemap existent — aucune ne mène à une page absente.
- Les quatre pages villes ont chacune leur ville dans le titre, un
  `BreadcrumbList`, une `FAQPage` et un `Service` avec ses tarifs.
- Chaque page ville reçoit 4 liens internes : aucune n'est orpheline.
- Les 7 articles de blog déclarent tous « Nice » comme zone servie.

---

## Ce qui ne se joue pas ici

Le référencement local se gagne surtout **hors du site**, et là je ne peux
rien mesurer d'ici :

- **La fiche Google Business** est le premier levier, très loin devant tout
  le reste. Catégorie exacte, horaires, zone de service, photos, et surtout
  **des avis récents et réguliers**.
- **La cohérence NAP sur les annuaires** : Pages Jaunes, Yelp, Apple Plans…
  La même adresse, écrite exactement pareil, partout.
- **Les liens locaux** : presse locale, associations, partenaires niçois.

Je peux préparer les textes et les listes ; je ne peux pas créer les comptes.
