# Booqable sur la version B — ce qui est fait, ce qui vous attend

## En deux phrases

Le bloc « Réserver cette machine » est en place sur la fiche du climatiseur,
avec exactement le code que vous m'avez donné :
`<div class="booqable-product" data-id="climatiseur-de-longhi"></div>`.
Il reste **invisible** tant qu'il vous manque une chose que moi je ne peux
pas avoir : le petit script de votre compte Booqable.

---

## Ce qu'il vous reste à faire (5 minutes)

### 1 · Récupérer votre script

Dans Booqable : **Settings → Website Integration → Javascript snippet**.

Copiez le bloc en entier, sans rien y changer. Il contient l'identifiant de
votre société — c'est un numéro que personne ne peut deviner, et cette
session n'a pas accès à votre compte Booqable.

### 2 · Le coller

Ouvrez `version-b.html`, allez tout en bas, et cherchez cette ligne :

```
>>> COLLER LE SNIPPET BOOQABLE JUSTE EN DESSOUS >>>
```

Collez juste en dessous. C'est tout.

### 3 · Vérifier

Rechargez la page, descendez à l'écran **« Le matériel »**.

- **Le bloc apparaît** sous la fiche du climatiseur → c'est bon, rien d'autre à faire.
- **Rien n'apparaît** → voir juste en dessous.

---

## Si rien n'apparaît

Ouvrez la console du navigateur (clic droit → Inspecter → Console) et
regardez les messages en rouge.

### Cas 1 — un message qui parle de « Content Security Policy »

C'est le garde du corps du site. Il refuse **par défaut** tout code venu d'un
autre serveur, et il le fait **sans rien dire au visiteur** : la page a l'air
normale, le widget n'est simplement jamais arrivé. Le site s'est déjà fait
avoir comme ça.

J'ai déjà autorisé `*.booqable.com` (script, styles, images, connexions,
iframes) dans `vercel.json`. Mais Booqable peut servir ses images depuis un
autre domaine.

**Le message d'erreur nomme toujours le domaine refusé.** Exemple :

```
Refused to load the image 'https://exemple-cdn.net/photo.jpg' because it
violates the following Content Security Policy directive: "img-src ..."
```

Ici, il faudrait ajouter `https://exemple-cdn.net` à la ligne `img-src` de
`vercel.json`. Envoyez-moi le message, je le fais.

### Cas 2 — un message qui vient de Booqable

`Loc'Air : Booqable n'a rien affiché…` dans la console veut dire que le
script n'a pas été collé, ou que l'identifiant du produit ne correspond à
rien.

Vérifiez dans Booqable que le produit porte bien l'identifiant
`climatiseur-de-longhi` (dans la fiche produit, onglet **Online store**).
S'il est différent, dites-le-moi : c'est une ligne à changer.

---

## Une chose à décider, et elle est à vous

Le site a **déjà** son propre parcours de réservation : le champ d'adresse en
haut, le calculateur (14 jours = 294 €), les trois formules à 144 / 214 /
349 €, et le paiement par Stripe.

Booqable, c'est un **deuxième** parcours, avec ses propres prix et son propre
panier.

Si les deux sont allumés en même temps, un visiteur peut voir **deux prix
différents pour la même machine** sur la même page. C'est le genre de détail
qui coûte une réservation.

Trois façons de s'en sortir, à vous de choisir :

1. **Booqable en plus, pour ce seul produit** — ce qui est en place aujourd'hui.
   À condition que les prix Booqable soient exactement les mêmes que ceux du
   site.
2. **Booqable à la place** — on retire le calculateur et les formules, et
   tout passe par Booqable.
3. **Booqable ailleurs** — sur une page à part, pas dans le parcours principal.

Dites-moi laquelle et je m'en occupe.

---

## Ce que j'ai touché

| Fichier | Ce qui a changé |
|---|---|
| `version-b.html` | Le bloc sur la fiche du climatiseur, l'endroit où coller le script, et le garde-fou qui masque le bloc s'il reste vide |
| `locair.css` | L'habillage du bloc, et une limite pour que le widget ne fasse pas déborder la page |
| `vercel.json` | `*.booqable.com` autorisé dans la Content-Security-Policy |

`index.html` n'est pas touché. Aucun changement de base de données.
