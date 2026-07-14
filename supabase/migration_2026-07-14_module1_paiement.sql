-- Module 1 — Réservation et paiement
-- À coller dans Supabase → SQL Editor AVANT de merger la PR correspondante.
-- Ce script est idempotent (ré-exécutable sans risque si déjà appliqué).

-- 1. Autorise le nouveau statut 'remboursee' sur reservations.statut, utilisé
--    par le webhook Stripe (event charge.refunded) — voir api/webhook.js.
alter table reservations drop constraint if exists reservations_statut_check;
alter table reservations add constraint reservations_statut_check
  check (statut in ('en_attente','confirmee','annulee','terminee','remboursee'));

-- 2. Trace d'audit des deux acceptations légales avant paiement (CGV/CGL et
--    conditions d'utilisation du climatiseur) — voir api/checkout.js et
--    api/_lib/legal.js.
create table if not exists cgv_acceptations (
  id             bigint generated always as identity primary key,
  reservation_id bigint not null references reservations(id) on delete cascade,
  type           text not null check (type in ('cgv_location','conditions_utilisation')),
  version        text not null,
  accepted_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (reservation_id, type)
);
create index if not exists cgv_acceptations_reservation_idx on cgv_acceptations (reservation_id);
