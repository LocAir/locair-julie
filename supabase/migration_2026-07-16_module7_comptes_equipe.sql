-- ================================================================
-- MODULE 7 — Administration Loc'Air V2 (Partie 31 : comptes équipe)
-- Ajoute de vrais comptes nominatifs avec des rôles différents,
-- en plus du mot de passe historique partagé (ADMIN_PASSWORD) qui
-- continue de fonctionner sans changement et vaut toujours le rôle
-- "administrateur" (accès complet) — aucune donnée existante à migrer.
-- ================================================================

create table admin_users (
  id            serial primary key,
  nom           text not null,
  email         text,
  pin           text not null unique,
  role          text not null check (role in ('administrateur','operateur','comptabilite','support_client')),
  actif         boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
