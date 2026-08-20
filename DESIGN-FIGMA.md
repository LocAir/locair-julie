# Design graphique Loc'Air — fichier Figma

Fichier : **Loc'Air — Design du site**
https://www.figma.com/design/fWXA5BKTCSrfypmoMjjyoN

But : pouvoir changer le look du site (couleurs, typos, boutons) directement
dans Figma, puis remettre ces changements dans le code du site.

## Ce qu'il y a dans le fichier

### Page « 🎨 Styles »
Les briques de base. On change une valeur ici, ça change partout.

**Couleurs** (nommées `couleur/...`)

| Nom Figma | Code | Où c'est utilisé |
|---|---|---|
| couleur/marine | `#1a2b4a` | Titres, boutons foncés, logo |
| couleur/marine-fonce | `#12203a` | Texte sur bouton doré |
| couleur/or | `#c5a96c` | Bouton principal, accents |
| couleur/fond | `#f4f6f9` | Fond des sections grises |
| couleur/fond-2 | `#e8ecf2` | Fond secondaire |
| couleur/blanc | `#ffffff` | Fond des cartes |
| couleur/texte | `#1a1a1a` | Texte principal |
| couleur/texte-2 | `#555555` | Texte secondaire |
| couleur/texte-3 | `#888888` | Petits textes gris |
| couleur/trait | `#e4e4e4` | Bordures |
| couleur/vert | `#16a34a` | Remises, dispo |
| couleur/rouge | `#dc2626` | Erreurs |

Plus : `arrondi/...` (8, 12, 20, 999 px) et `espace/...` (8 à 96 px).

**Typos** (styles de texte)
- Titre/Hero — Inter Extra Bold 62
- Titre/Section — Cormorant Garamond SemiBold 58
- Titre/Sous-section, Titre/Carte, Titre/Petit
- Corps/Grand, Corps/Normal, Corps/Petit
- Bouton, Bouton/Petit, Sur-titre, Nav/Lien, Micro, Logo

**Ombres** : Ombre/XS, SM, MD, LG, Marine, Or.

**Composants réutilisables**
- `Bouton` — 6 versions : Principal / Secondaire / Sombre × Grand / Petit
- `Item réassurance`
- `Carte étape`

### Page « 🏠 Accueil »
La page d'accueil refaite à l'identique, en 1440 px de large :
1. Navigation
2. Hero (texte + photo du climatiseur)
3. Réassurance (4 blocs)
4. Comment ça marche (4 étapes)
5. Produit (fiche + caractéristiques)
6. Tarifs (prix, paliers dégressifs, louer vs acheter)

## Ce qui reste à faire
- Sections Avis, FAQ, CTA final, Footer
- Retirer l'emoji 🔧 dans la ligne « Installation par technicien » (Figma ne
  l'affiche pas)
- Remplacer la photo du hero par le fichier `hero-clim.jpg` en pleine qualité
  (celle importée est une version allégée)

Blocage rencontré : le plan Figma **Starter (gratuit)** limite le nombre
d'actions automatiques par jour. La limite a été atteinte — il faut soit
attendre le renouvellement du quota, soit passer sur un plan payant pour
finir les 4 dernières sections automatiquement.

## Comment on travaille ensuite
1. Tu modifies dans Figma (couleurs, typos, espacements, mise en page).
2. On relit le fichier Figma et on reporte les changements dans
   `index.html` (les variables CSS en haut du fichier, autour de la ligne 178).
