-- Prospection terrain des points de retrait (25/11/2026).
-- Une ligne = un commerce visité par un prospecteur Loc'Air.
-- Parcours : le prospecteur ouvre une « visite » (QR code de session) →
-- le commerçant scanne, choisit 3, 4 ou 5 climatiseurs et touche « OK »
-- (statut en_attente_signature) → le prospecteur prend 1 photo + GPS →
-- le commerçant signe du doigt (signe) ou reçoit la convention par email
-- pour signer plus tard. Gérant absent : photo + GPS seulement (a_repasser).
create table if not exists prospection_points (
  id              bigint generated always as identity primary key,
  session_token   text not null unique,
  statut          text not null default 'session'
                  check (statut in ('session','a_repasser','en_attente_signature','signe','refuse')),
  zone            text,
  enseigne        text,
  gerant          text,
  tel             text,
  email           text,
  adresse         text,
  capacite        int check (capacite between 1 and 20),
  accepte_at      timestamptz,
  photo_path      text,
  lat             double precision,
  lng             double precision,
  gps_precision   double precision,
  signataire      text,
  signature_path  text,
  signe_at        timestamptz,
  docs_envoyes_at timestamptz,
  relance_at      timestamptz,
  prospecteur     text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists prospection_points_statut_idx on prospection_points (statut, created_at desc);
alter table prospection_points enable row level security;

-- Nouveau rôle d'équipe « prospecteur » (jeunes recrutés) : accès à
-- l'appli terrain seulement (/prospection), rien d'autre dans l'admin.
alter table admin_users drop constraint if exists admin_users_role_check;
alter table admin_users add constraint admin_users_role_check
  check (role in ('administrateur','operateur','comptabilite','support_client','prospecteur'));
