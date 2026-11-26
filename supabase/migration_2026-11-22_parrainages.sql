-- Parrainages entre commerçants points de retrait (22/11/2026).
-- Une ligne par demande de rappel envoyée depuis un lien de parrainage
-- (/parrainage). Le parrain la voit dans son espace partenaire ; l'admin la
-- passe à « signé » (parrainage activé : 1re location du nouveau point
-- reversée à 100 % au parrain et au nouveau) ou « refusé ».
create table if not exists parrainages (
  id          bigint generated always as identity primary key,
  parrain_id  bigint references partenaires(id),
  parrain_nom text,
  commerce    text not null,
  contact_nom text,
  tel         text,
  statut      text not null default 'en_attente' check (statut in ('en_attente','signe','refuse')),
  created_at  timestamptz not null default now(),
  signe_at    timestamptz
);
-- Détection automatique (22/11/2026) : fiche du nouveau commerçant reliée
-- (filleul_id) et sa 1re location repérée (premiere_resa_id) pour l'alerte
-- « à verser ». « add column if not exists » : marche aussi si la table
-- existait déjà.
alter table parrainages add column if not exists filleul_id bigint references partenaires(id);
alter table parrainages add column if not exists premiere_resa_id bigint references reservations(id);
create index if not exists parrainages_filleul_idx on parrainages (filleul_id) where filleul_id is not null;
create index if not exists parrainages_parrain_idx on parrainages (parrain_id, created_at desc);
