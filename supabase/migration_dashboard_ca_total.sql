-- ─────────────────────────────────────────────────────────────────────────────
-- Migration : chiffre d'affaires total calculé côté base pour le tableau de
-- bord admin (api/admin-dashboard.js, champ ca_total_euros).
--
-- Avant cette migration, le code téléchargeait une ligne par réservation
-- confirmée de TOUT l'historique de la ville pour additionner côté Node —
-- requête rejouée à chaque ouverture du tableau de bord ET toutes les 18s
-- tant que l'onglet reste ouvert (rafraîchissement automatique côté
-- admin/index.html). Plus l'activité grossit, plus c'était lent, sans aucune
-- limite naturelle.
--
-- Cette fonction fait calculer la somme directement par Postgres (un seul
-- nombre renvoyé, aucune ligne téléchargée) — même principe que les fonctions
-- déjà présentes dans supabase/schema.sql (available_units, assign_appareils).
--
-- À exécuter dans Supabase → SQL Editor (une seule fois).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function ca_total_ville(p_city_id bigint)
returns bigint
language sql
stable
as $$
  select coalesce(sum(prix_total_cents), 0)::bigint
  from reservations
  where city_id = p_city_id and statut = 'confirmee';
$$;
