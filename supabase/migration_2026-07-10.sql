-- Migration 2026-07-10
-- À exécuter dans Supabase → SQL Editor (une seule fois)

-- Commandes hors zone de livraison : code postal non couvert par aucune ville
-- configurée — acceptées en fallback sur la 1ère ville active, marquées pour
-- traitement manuel par l'admin dans l'onglet Réservations.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS hors_zone boolean NOT NULL DEFAULT false;

-- Types de mission autorisés par transporteur (stocké comme tableau de textes).
-- Exemples : '{livraison,recuperation}', '{livraison,recuperation,changement}'.
-- Tableau vide = aucune restriction (comportement historique).
ALTER TABLE transporteurs ADD COLUMN IF NOT EXISTS types_autorises text[] NOT NULL DEFAULT '{}';
