-- ─────────────────────────────────────────────────────────────────────────────
-- Catégories de tutoriels éditables par l'admin (jusqu'ici figées dans le
-- code — 7 catégories fixes, impossible d'en ajouter une nouvelle sans
-- intervention développeur). Reprend les 7 catégories existantes telles
-- quelles (même clé, même libellé, même ordre, même actif) pour que rien ne
-- change pour les vidéos déjà en place.
-- À exécuter dans Supabase → SQL Editor (une seule fois)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists tuto_categories (
  id         bigint generated always as identity primary key,
  key        text not null unique,
  label      text not null,
  ordre      integer not null default 0,
  actif      boolean not null default true,
  created_at timestamptz not null default now()
);

insert into tuto_categories (key, label, ordre, actif) values
  ('acces_sortie_boxe',     '🚪 Accès / sortie box',                 1, true),
  ('recuperation_materiel', '📦 Récupération matériel',              2, true),
  ('fermeture_boxe',        '🔒 Fermeture box',                      3, true),
  ('entree_sortie_centre',  '🏢 Entrée / sortie du centre',          4, true),
  ('chargement',            '⬆️ Chargement',                         5, false),
  ('dechargement',          '⬇️ Déchargement',                       6, true),
  ('installation',          '🔧 Installation par type d''ouverture', 7, true)
on conflict (key) do nothing;

-- tutoriel_videos.categorie référençait une liste figée de 7 valeurs (check
-- constraint) — retirée pour permettre une nouvelle catégorie créée depuis
-- l'admin. La cohérence est maintenant garantie côté application
-- (api/admin-tutoriels.js vérifie que la catégorie existe dans
-- tuto_categories avant d'accepter une vidéo).
alter table tutoriel_videos drop constraint if exists tutoriel_videos_categorie_check;
