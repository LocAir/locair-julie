-- ─────────────────────────────────────────────────────────────────────────────
-- Bibliothèque de tutoriels vidéo (prise en main transporteur) — vidéos
-- catégorisées, uploadées par l'admin, avec suivi "vu en entier" par
-- transporteur. Bibliothèque unique, non liée à une ville.
-- À exécuter dans Supabase → SQL Editor (une seule fois)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists tutoriel_videos (
  id             bigint generated always as identity primary key,
  categorie      text not null check (categorie in (
                   'acces_sortie_boxe','recuperation_materiel','fermeture_boxe',
                   'entree_sortie_centre','chargement','dechargement','installation'
                 )),
  -- Catégorie 7 (installation) seulement : porte fenêtre / fenêtre battante /
  -- porte coulissante / volet. Pas de check() sur les valeurs — détail exact
  -- laissé à l'étape future qui remplira cette catégorie.
  sous_categorie text,
  titre          text not null,
  -- null tant qu'aucun fichier n'est uploadé (slot de métadonnées créé à
  -- l'avance par l'admin, avant d'avoir la vidéo elle-même).
  storage_path   text,
  ordre          integer not null default 0,
  actif          boolean not null default true,
  created_at     timestamptz not null default now()
);
create index if not exists tutoriel_videos_categorie_idx on tutoriel_videos (categorie, ordre);

-- L'existence d'une ligne = vue en entier au moins une fois par ce
-- transporteur — même convention que checklist_box (ligne = événement).
create table if not exists tutoriel_vus (
  transporteur_id bigint not null references transporteurs(id) on delete cascade,
  video_id        bigint not null references tutoriel_videos(id) on delete cascade,
  vu_complet_at   timestamptz not null default now(),
  primary key (transporteur_id, video_id)
);
