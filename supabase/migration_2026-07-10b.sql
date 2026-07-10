-- Migration 2026-07-10b
-- À exécuter dans Supabase → SQL Editor (une seule fois)

-- Met à jour tous les transporteurs ayant types_autorises vide (toutes missions
-- autorisées par défaut) pour le renseigner explicitement avec les 4 types.
-- Cela permet à l'admin de voir les coches pré-remplies dans "Modifier la fiche"
-- et de restreindre certains transporteurs à certains types si besoin.
UPDATE transporteurs
SET types_autorises = ARRAY['livraison', 'livraison_technicien', 'recuperation', 'changement']
WHERE types_autorises = '{}' OR types_autorises IS NULL;
