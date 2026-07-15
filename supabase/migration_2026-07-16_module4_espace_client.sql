-- Module 4 — Espace client Loc'Air
-- À coller dans Supabase → SQL Editor AVANT de merger la PR correspondante.
-- Ce script est idempotent (ré-exécutable sans risque si déjà appliqué).

-- 1. Catalogue des modèles de climatiseur (Rowenta, Frico...) — une seule
--    fiche par modèle, réutilisée par tous les appareils physiques de ce
--    modèle (jamais dupliquée par appareil). appareils.modele_id reste
--    nullable : un appareil sans modèle assigné retombe sur une description
--    générique côté espace client.
create table if not exists modeles_climatiseur (
  id                  bigint generated always as identity primary key,
  marque              text not null,
  modele              text not null,
  puissance_btu       text,
  surface_max_m2      text,
  niveau_sonore_db    text,
  classe_energie      text,
  photo_url           text,
  conseils_utilisation text,
  video_tutoriel_url  text,
  documentation_url   text,
  actif               boolean not null default true,
  created_at          timestamptz not null default now()
);

alter table appareils add column if not exists modele_id bigint references modeles_climatiseur(id);

-- 2. Centre d'aide client — contenu administrable (voir api/admin-aide.js),
--    structuré par catégorie/slug pour rester exploitable telle quelle par
--    un futur assistant IA (recherche par mots-clés, pas de développement
--    de chatbot en V1).
create table if not exists centre_aide_articles (
  id         bigint generated always as identity primary key,
  slug       text not null unique,
  categorie  text,
  titre      text not null,
  contenu    text not null,
  ordre      integer not null default 0,
  actif      boolean not null default true,
  created_at timestamptz not null default now()
);

-- 3. Coordonnées d'assistance affichées dans l'espace client — une seule
--    ligne, jamais codée en dur dans le front (voir api/admin-assistance.js).
create table if not exists assistance_config (
  id         integer primary key default 1,
  horaires   text default 'Tous les jours, 8h–20h',
  telephone  text default '06 63 79 87 56',
  email      text default 'contact@locair.fr',
  urgence    text default 'En cas de panne, contactez-nous directement par téléphone ou WhatsApp.',
  updated_at timestamptz not null default now(),
  constraint assistance_config_single_row check (id = 1)
);
insert into assistance_config (id) values (1) on conflict (id) do nothing;
