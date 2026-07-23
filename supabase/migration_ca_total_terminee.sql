-- ─────────────────────────────────────────────────────────────────────────────
-- Correctif : le "CA total" du tableau de bord admin (api/admin-dashboard.js,
-- champ ca_total_euros, fonction SQL ca_total_ville — voir
-- migration_dashboard_ca_total.sql) ne comptait que les réservations encore
-- au statut 'confirmee'. Or une réservation passe automatiquement à
-- 'terminee' dès que la récupération est faite (fin de location normale,
-- voir admin-livraisons.js/transporteur-action.js) — c'est l'issue attendue
-- de la quasi-totalité des locations qui vont à leur terme.
--
-- Résultat concret : le chiffre d'affaires total affiché sur le tableau de
-- bord n'a jamais compté une seule location déjà terminée — potentiellement
-- une très grosse sous-estimation du CA réel, sans aucune erreur visible.
--
-- Même principe déjà appliqué ailleurs dans le code pour la même raison
-- (voir _lib/emailSchedule.js:pastScenariosForReservation, ou le correctif
-- des commissions partenaires du même jour).
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
  where city_id = p_city_id and statut in ('confirmee', 'terminee');
$$;
