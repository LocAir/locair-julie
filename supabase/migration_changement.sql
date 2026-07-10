-- Migration : type 'changement' pour livraisons (remplacement de clim)
-- À exécuter dans Supabase → SQL Editor (une seule fois)

ALTER TABLE livraisons DROP CONSTRAINT IF EXISTS livraisons_type_check;
ALTER TABLE livraisons ADD CONSTRAINT livraisons_type_check
  CHECK (type IN ('livraison', 'recuperation', 'changement'));
