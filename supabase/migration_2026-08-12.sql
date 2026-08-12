-- Migration 2026-08-12
-- À exécuter dans Supabase → SQL Editor (une seule fois)

-- Livraison express (sous 2h) : coché à la main par l'admin sur une mission
-- de type 'livraison' (jamais récupération/changement) — ajoute
-- automatiquement 30€ au tarif du transporteur, en plus du barème normal
-- (zone ou hors zone), peu importe la ville. Voir api/_lib/bareme.js.
ALTER TABLE livraisons ADD COLUMN IF NOT EXISTS express boolean NOT NULL DEFAULT false;
