-- Click & Collect — compteur d'étapes de la page (tableau de bord + test A/B).
-- Aucune donnée personnelle : nom de l'étape, variante du titre (A/B) et un
-- numéro de visite tiré au hasard par le navigateur (oublié à la fermeture
-- de l'onglet). À coller UNE FOIS dans Supabase → SQL Editor.
create table if not exists cc_evenements (
  id         bigserial primary key,
  cree_le    timestamptz not null default now(),
  evenement  text not null,
  variante   text not null default 'A',
  visite     text not null
);
create index if not exists cc_evenements_cree_le_idx on cc_evenements (cree_le);
alter table cc_evenements enable row level security;
