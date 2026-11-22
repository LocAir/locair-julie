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
create index if not exists parrainages_parrain_idx on parrainages (parrain_id, created_at desc);
