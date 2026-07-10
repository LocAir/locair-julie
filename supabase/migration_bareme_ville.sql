-- ─────────────────────────────────────────────────────────────────────────────
-- Migration : barème éditable par ville (remplace le taux fixé par transporteur)
-- À exécuter dans Supabase → SQL Editor (une seule fois)
-- ─────────────────────────────────────────────────────────────────────────────

-- Rattrapage : le type 'changement' (remplacement de clim en panne) est déjà
-- utilisé par le code déployé mais la contrainte de la base ne l'autorisait
-- pas encore — à exécuter avant toute mission de type 'changement', sans quoi
-- l'insertion échoue.
ALTER TABLE livraisons DROP CONSTRAINT IF EXISTS livraisons_type_check;
ALTER TABLE livraisons ADD CONSTRAINT livraisons_type_check
  CHECK (type IN ('livraison', 'recuperation', 'changement'));

-- Barème payé au transporteur par mission, éditable dans l'admin (onglet
-- Villes). null = valeur par défaut du barème (voir api/_lib/bareme.js) —
-- donc sans risque à exécuter, comportement inchangé tant qu'aucune valeur
-- n'est explicitement définie.
ALTER TABLE cities ADD COLUMN IF NOT EXISTS tarif_livraison_autonome_cents   integer;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS tarif_livraison_technicien_cents integer;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS tarif_recuperation_cents         integer;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS tarif_changement_cents           integer;
