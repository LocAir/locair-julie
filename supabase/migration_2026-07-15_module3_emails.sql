-- Module 3 — Emails Brevo et automatisations client
-- À coller dans Supabase → SQL Editor AVANT de merger la PR correspondante.
-- Ce script est idempotent (ré-exécutable sans risque si déjà appliqué).

-- 1. Catalogue des scénarios email — permet de désactiver un scénario depuis
--    l'administration (voir api/admin-emails.js) sans toucher au code.
create table if not exists email_scenarios (
  id         text primary key,
  libelle    text not null,
  actif      boolean not null default true,
  created_at timestamptz not null default now()
);
insert into email_scenarios (id, libelle) values
  ('confirmation',        'Confirmation de réservation'),
  ('suivi_j14',           'Suivi J-14'),
  ('preparation_j3',      'Préparation J-3'),
  ('rappel_j1',           'Rappel J-1 (livraison)'),
  ('post_installation',   'Post-installation'),
  ('avant_fin_location',  'Avant fin de location (prolongation)'),
  ('rappel_recuperation', 'Rappel J-1 (récupération)'),
  ('fin_location',        'Fin de location (avis)')
on conflict (id) do nothing;

-- 2. Garantit qu'un scénario n'est JAMAIS envoyé deux fois pour la même
--    réservation (clé primaire composite) — vérifiée avant tout envoi
--    automatique (le renvoi manuel admin passe par `force`, voir
--    _lib/emailEngine.js, et met simplement à jour sent_at).
create table if not exists email_sent (
  reservation_id bigint not null references reservations(id) on delete cascade,
  scenario       text not null references email_scenarios(id),
  sent_at        timestamptz not null default now(),
  primary key (reservation_id, scenario)
);

-- 3. Historique complet de chaque tentative d'envoi (succès ou échec) —
--    consultable depuis l'administration, jamais purgé.
create table if not exists email_log (
  id             bigint generated always as identity primary key,
  reservation_id bigint references reservations(id) on delete cascade,
  scenario       text not null,
  destinataire   text,
  modele         text,
  statut         text not null check (statut in ('envoye','erreur')),
  erreur         text,
  created_at     timestamptz not null default now()
);
create index if not exists email_log_reservation_idx on email_log (reservation_id, created_at desc);
create index if not exists email_log_scenario_idx on email_log (scenario);

-- 4. Signature email administrable (nom expéditeur, fonction, logo,
--    coordonnées, site) — une seule ligne (id=1), modifiable depuis
--    l'administration (voir api/admin-email-signature.js). Indépendante de la
--    signature du webmail IONOS.
create table if not exists email_signature (
  id             integer primary key default 1,
  nom_expediteur text not null default 'Loc''Air',
  fonction       text,
  logo_url       text,
  telephone      text,
  email          text not null default 'contact@locair.fr',
  site_web       text default 'https://www.locair.fr',
  updated_at     timestamptz not null default now(),
  constraint email_signature_single_row check (id = 1)
);
insert into email_signature (id) values (1) on conflict (id) do nothing;
