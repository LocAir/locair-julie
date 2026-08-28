# Booqable sur la version B — ce qui est fait, ce qui vous attend

## En deux phrases

Le bloc « Réserver cette machine » est en place sur la fiche du climatiseur,
avec exactement le code que vous m'avez donné :
`<div class="booqable-product" data-id="climatiseur-de-longhi"></div>`.
Il reste **invisible** tant qu'il vous manque une chose que moi je ne peux
pas avoir : le petit script de votre compte Booqable.

Choix retenu : **Booqable en plus du parcours du site, pour ce seul produit.**
La condition qui va avec est plus bas, avec les chiffres à recopier.

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

## La décision est prise : Booqable EN PLUS, pour ce seul produit

Le site garde son parcours — champ d'adresse, calculateur, formules, Stripe.
Booqable s'ajoute sur la fiche du climatiseur, et nulle part ailleurs.

C'est ce qui est en place. **Mais cette option a une condition, et une seule :**

> Les prix dans Booqable doivent être **exactement** ceux du site.

Sinon un visiteur voit deux prix différents pour la même machine sur la même
page. C'est le genre de détail qui coûte une réservation — et qui coûte la
confiance, ce qui est pire.

### Le barème à recopier dans Booqable

Ce sont les chiffres du site, pris dans le code (`version-b.html`, le même
barème que la caisse). **Location dégressive par tranches** : les 7 premiers
jours restent à 12 €, seuls les jours suivants passent au tarif inférieur.

| Jours | Prix par jour |
|---|---|
| 1 à 7 | **12,00 €** |
| 8 à 14 | **10,00 €** |
| 15 à 21 | **9,00 €** |
| à partir du 22ᵉ | **8,00 €** |

Et à côté de la location :

| | |
|---|---|
| Durée minimum | **7 jours** |
| Livraison, zone standard (Nice, Saint-Laurent-du-Var, Cagnes-sur-Mer) | **60 €** |
| Livraison, hors zone | **120 €** |
| Pose sur place (option) | **80 €** |
| Caution | **aucune** |
| Quantité maximum | **5 machines** |
| Durée maximum | **90 jours** |

### Les trois totaux à vérifier

Une fois le barème entré, faites trois essais dans Booqable. Si ces trois
nombres tombent juste, le reste tombera juste aussi — ce sont exactement les
trois formules affichées sur le site.

| Durée | Ce que Booqable doit afficher | D'où ça vient |
|---|---|---|
| 7 jours | **144 €** | 84 € de location + 60 € de livraison |
| 14 jours | **214 €** | 154 € + 60 € |
| 30 jours | **349 €** | 289 € + 60 € |

Si un seul de ces trois ne tombe pas juste, **ne mettez pas Booqable en ligne**
et dites-le-moi : c'est le barème qui est mal entré, pas le site.

### ⚠ Un piège : le calculateur affiche 294 €, pas 214 €

Ne comparez pas Booqable au **calculateur** de la page, comparez-le aux
**trois formules**.

Le calculateur démarre avec **la pose incluse** (80 €). Pour 14 jours il
affiche donc `154 + 60 + 80 = 294 €`, alors que la formule « 2 semaines »
affiche `154 + 60 = 214 €`. Les deux sont justes — ils ne comptent pas la
même chose.

Vérifié en direct sur la page : 7 j = 144 €, 14 j = 214 €, 30 j = 349 € sans
la pose ; 224 €, 294 € et 429 € avec.

Donc : dans Booqable, la pose doit être une **option à cocher à 80 €**, pas
un montant fondu dans le prix.

### Si vous changez les prix un jour

Ils sont à **deux endroits** désormais : dans Booqable, et dans le site. Le
site les lit depuis `/api/pricing-config`, avec les valeurs ci-dessus en
secours. Changer l'un sans l'autre remet deux prix sur la même page.

Dites-le-moi quand ça arrive, je m'occupe du côté site.

## Ce que j'ai touché

| Fichier | Ce qui a changé |
|---|---|
| `version-b.html` | Le bloc sur la fiche du climatiseur, l'endroit où coller le script, et le garde-fou qui masque le bloc s'il reste vide |
| `locair.css` | L'habillage du bloc, et une limite pour que le widget ne fasse pas déborder la page |
| `vercel.json` | `*.booqable.com` autorisé dans la Content-Security-Policy |

`index.html` n'est pas touché. Aucun changement de base de données.
