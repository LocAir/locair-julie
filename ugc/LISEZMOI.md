# Vidéos clients (UGC) — page /click-and-collect

Ce dossier reçoit les vidéos de clients affichées dans la section
« Ils l'ont testé » de la page Click & Collect.

## Pour ajouter une vidéo

1. **Accord écrit du client** (droit à l'image) : qu'il accepte que sa
   vidéo soit publiée sur locair.fr et les réseaux de Loc'Air. Sans
   accord, on ne publie pas.
2. Format : vidéo **verticale** (9:16), **15 à 40 secondes**, en MP4
   (H.264), **5 Mo maximum** (compresser si besoin).
3. Une image fixe de la vidéo en `.webp` (même nom), pour l'affichage
   avant lecture.
4. Déposer les deux fichiers ici, par ex. `ugc/sophie-nice.mp4` et
   `ugc/sophie-nice.webp`.
5. Ajouter une ligne dans la liste `UGC` de `click-and-collect.html`
   (chercher « VIDÉOS CLIENTS ») :

   ```js
   { video:'/ugc/sophie-nice.mp4', image:'/ugc/sophie-nice.webp', prenom:'Sophie', ville:'Nice',
     texte:{ fr:'Récupéré en 5 minutes !', en:'Picked up in 5 minutes!' } },
   ```

Tant que la liste est vide, la section n'apparaît pas sur le site.
Aperçu avec des images d'exemple : `locair.fr/click-and-collect?ugc=demo`.

Le texte affiché doit être **ce que le client a vraiment dit** dans sa
vidéo (une phrase courte). Rien d'inventé.
