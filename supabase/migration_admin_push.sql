-- ─────────────────────────────────────────────────────────────────────────────
-- Migration : notifications push pour l'espace admin
-- À exécuter dans Supabase → SQL Editor (une seule fois)
-- ─────────────────────────────────────────────────────────────────────────────

-- Abonnements aux notifications push du navigateur pour l'espace admin.
-- Pas de colonne "propriétaire" (contrairement à push_subscriptions qui a
-- transporteur_id) : l'admin n'a qu'un seul compte partagé (mot de passe),
-- pas d'identité par utilisateur — un abonnement par appareil/navigateur.
create table if not exists admin_push_subscriptions (
  id         bigint generated always as identity primary key,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
