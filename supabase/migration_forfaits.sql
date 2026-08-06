-- ================================================================
-- FORFAITS — packs à prix fixe (ex. "Pack Sérénité Solo", "Pack Sérénité
-- Duo"), distincts du tarif dégressif normal (pricing_config). Un forfait a
-- un prix TOTAL fixe pour une durée et une quantité données, qui ne bouge
-- jamais même si le barème dégressif change ensuite — contrairement à une
-- remise en % (table promotions), qui elle recalcule à partir du tarif du
-- moment.
-- ================================================================

create table forfaits (
  id            bigint generated always as identity primary key,
  nom           text not null,             -- ex. "Pack Sérénité Solo"
  quantite      integer not null check (quantite between 1 and 5),
  duree_jours   integer not null check (duree_jours between 1 and 90),
  prix_cents    integer not null check (prix_cents > 0),  -- prix TOTAL fixe (hors livraison/installation)
  actif         boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index forfaits_actif_idx on forfaits (actif);

-- Trace, sur la réservation elle-même, qu'elle vient d'un pack à prix fixe
-- — utile pour que l'admin voie tout de suite "Pack Sérénité Duo" plutôt
-- qu'une réservation "normale" de 2 climatiseurs sur 30 jours.
alter table reservations add column if not exists forfait_id bigint references forfaits(id) on delete set null;
