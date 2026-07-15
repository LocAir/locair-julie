-- Panneau de contrôle des communications client (admin) : historique
-- complet emails/SMS + pause/suppression d'un envoi précis à venir.
-- Voir CLAUDE.md : à coller dans Supabase → SQL Editor, confirmer avant de
-- merger la PR correspondante.

alter table email_log add column if not exists canal text not null default 'email' check (canal in ('email','sms'));

create table if not exists email_skip (
  reservation_id bigint not null references reservations(id) on delete cascade,
  scenario       text not null references email_scenarios(id),
  action         text not null default 'suppression' check (action in ('pause','suppression')),
  created_at     timestamptz not null default now(),
  primary key (reservation_id, scenario)
);
