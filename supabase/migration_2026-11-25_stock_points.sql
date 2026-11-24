-- Stock de climatiseurs par point de retrait, modifiable depuis l'admin
-- (25/11/2026) : il peut évoluer d'un point à l'autre et dans le temps,
-- avec l'accord du gérant. Une ligne remplace le stock écrit dans
-- api/_lib/pointsRetrait.js. Chaque changement est gardé dans l'historique.
create table if not exists stock_points (
  point_id   text primary key,
  stock      int not null check (stock between 0 and 30),
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table stock_points enable row level security;

create table if not exists stock_points_historique (
  id            bigint generated always as identity primary key,
  point_id      text not null,
  ancien        int,
  nouveau       int not null,
  raison        text,
  accord_gerant boolean not null default false,
  par           text,
  created_at    timestamptz not null default now()
);
create index if not exists stock_points_historique_idx on stock_points_historique (point_id, created_at desc);
alter table stock_points_historique enable row level security;

-- Prospection terrain : le nombre de climatiseurs à la signature n'est plus
-- limité à 3–5 (souvent 3, 4 ou 5, mais libre de 1 à 20).
alter table prospection_points drop constraint if exists prospection_points_capacite_check;
alter table prospection_points add constraint prospection_points_capacite_check check (capacite between 1 and 20);
