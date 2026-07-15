-- ─────────────────────────────────────────────────────────────────────────────
-- Migration : adresse du box (dépôt matériel) par ville, pour le calcul de
-- tournée du transporteur (plus proche en voiture, api/transporteur-route.js)
-- À exécuter dans Supabase → SQL Editor (une seule fois)
-- ─────────────────────────────────────────────────────────────────────────────
alter table cities add column if not exists depot_adresse text;
alter table cities add column if not exists depot_lat double precision;
alter table cities add column if not exists depot_lng double precision;
