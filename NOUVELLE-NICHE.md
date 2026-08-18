# Lancer un site pour une nouvelle niche

Le fichier `nouvelle-version.html` n'est pas qu'une page : c'est un **gabarit**.
Pour tester une nouvelle activité (chauffage d'appoint, déshumidificateur,
mobilier, autre ville…), on le copie et on change le texte. Aucun code à
écrire.

---

## En 5 étapes

**1. Copier le fichier**

```
cp nouvelle-version.html chauffage.html
```

Le nom du fichier devient l'adresse : `chauffage.html` → `locair.fr/chauffage`

**2. Changer la marque**

Chercher le bloc marqué `[MARQUE]` en haut du fichier. Trois choses à
remplacer partout : le nom, le numéro de téléphone, le lien WhatsApp.
Un simple « Rechercher / Remplacer » suffit :

| Chercher | Remplacer par |
|---|---|
| `Loc'Air` | le nom de la nouvelle marque |
| `06.63.79.87.56` | le nouveau numéro |
| `33663798756` | le numéro WhatsApp, sans le 0 et avec 33 devant |

**3. Changer les couleurs (seulement si autre identité)**

Le bloc `[COULEURS]`, tout en haut du `<style>`. Quatre lignes :

```css
--blue:#1A2B4A;    /* la couleur principale */
--gold:#C5A96C;    /* la couleur d'accent */
--white:#FFFFFF;
--bg:#F4F6F9;      /* le gris très clair des sections */
```

Changer ces quatre valeurs suffit à repeindre tout le site.
⚠️ Ne pas toucher à `--gold-txt` : c'est une version foncée de l'accent,
prévue pour que les petits textes restent lisibles.

**4. Changer les textes**

Chaque section à personnaliser porte un commentaire `[À CHANGER]` :

- la promesse du hero (le grand titre)
- les 6 tuiles de preuves
- les 4 étapes
- le produit et ses caractéristiques
- les prix
- les avis clients
- le fondateur
- les questions fréquentes
- la zone de livraison

**5. Cacher la page de Google pendant les tests**

Tant que le site est en essai, ajouter une ligne dans `robots.txt` :

```
Disallow: /chauffage.html
```

Et laisser la ligne `<meta name="robots" content="noindex,nofollow">`
dans le fichier. **Quand le site est validé et qu'on veut être trouvé sur
Google, il faut retirer les deux.**

---

## Les vidéos clients

Le mur de témoignages attend de vraies vidéos. Le format :

- **Vertical** (9:16), filmé au téléphone, tenu debout
- **15 à 40 secondes**, pas plus
- Pas de montage, pas de musique — c'est l'effet « vrai client » qui vend
- Une image d'aperçu (`poster`) : une capture de la vidéo, en `.jpg`

Pour en ajouter une, remplacer le contenu d'une carte par le bloc écrit en
commentaire juste au-dessus de la section dans le fichier HTML.

**Trois règles à ne pas casser**, sinon les vidéos ralentissent tout le site :

| Attribut | Pourquoi |
|---|---|
| `preload="none"` | rien ne se télécharge tant qu'on ne clique pas |
| `poster="…jpg"` | une image s'affiche tout de suite, à la place de la vidéo |
| `playsinline` | sur iPhone, la vidéo ne part pas en plein écran |

**Où héberger les fichiers** : Supabase Storage. Il est déjà autorisé par la
sécurité du site (`media-src https://*.supabase.co` dans `vercel.json`), donc
rien à configurer.

---

## Ce que ce gabarit ne fait PAS

C'est une **vitrine**. Il n'y a dedans :

- ni tunnel de réservation,
- ni paiement,
- ni base de données.

Tous les boutons « Réserver » renvoient vers `/`, c'est-à-dire `index.html`,
qui garde toute la machinerie. Pour qu'une nouvelle niche encaisse vraiment,
il faudra brancher son propre tunnel — c'est un autre chantier, bien plus
gros.

## Deux choses volontairement absentes

- **Le suivi Google Ads.** Une page de test ne doit pas envoyer de fausses
  conversions au compte publicitaire, sinon Google apprend n'importe quoi et
  dépense le budget de travers. À rajouter seulement quand le site est lancé
  pour de vrai.
- **Les données structurées schema.org.** Deux fiches d'entreprise identiques
  sur le même domaine se concurrencent dans les résultats Google. À écrire
  spécifiquement pour chaque niche, au moment de la mise en ligne.
