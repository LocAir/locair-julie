-- ─────────────────────────────────────────────────────────────────────────────
-- Migration : sold_out + triggers d'automatisation
-- À exécuter dans Supabase → SQL Editor (une seule fois)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Colonne sold_out sur cities (si pas encore faite)
ALTER TABLE cities ADD COLUMN IF NOT EXISTS sold_out boolean NOT NULL DEFAULT false;

-- 2. Colonne en_pause sur transporteurs (si pas encore faite)
ALTER TABLE transporteurs ADD COLUMN IF NOT EXISTS en_pause boolean NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Fonction centrale de calcul : recalcule sold_out pour une ville donnée
--    Logique : sold_out = true  ↔  0 appareil disponible aujourd'hui
--              sold_out = false ↔  ≥ 1 appareil libre aujourd'hui
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _auto_sold_out(p_city_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_disponibles int;
BEGIN
  -- Unités actives dans cette ville (même exclusion que available_units :
  -- panne/maintenance/loue exclus, nettoyage inclus comme disponible)
  SELECT COUNT(*)::int INTO v_disponibles
  FROM appareils
  WHERE city_id = p_city_id
    AND statut NOT IN ('panne', 'maintenance', 'loue');

  -- Moins celles déjà assignées à une résa confirmée couvrant aujourd'hui.
  -- Bug corrigé : l'ancienne version comptait v_en_location même si les unités
  -- assignées avaient statut='panne'/'maintenance', ce qui pouvait donner
  -- v_en_location >= v_total alors que des unités libres existaient.
  v_disponibles := v_disponibles - COALESCE((
    SELECT COUNT(DISTINCT ra.appareil_id)
    FROM reservation_appareils ra
    JOIN reservations r ON r.id = ra.reservation_id
    WHERE r.city_id    = p_city_id
      AND r.statut     = 'confirmee'
      AND r.date_debut <= CURRENT_DATE
      AND r.date_fin   >  CURRENT_DATE
  ), 0);

  UPDATE cities
  SET sold_out = (v_disponibles <= 0)
  WHERE id = p_city_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4a. Trigger sur reservations
--     → se déclenche quand le statut change (nouvelle résa confirmée, annulée,
--       terminée). Couvre les cas :
--       • confirmation : sold_out peut passer à true  (flotte pleine)
--       • annulation / fin : sold_out peut passer à false (unité libérée)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _trg_reservation_sold_out()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM _auto_sold_out(COALESCE(NEW.city_id, OLD.city_id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservation_sold_out ON reservations;
CREATE TRIGGER trg_reservation_sold_out
  AFTER INSERT OR UPDATE OF statut ON reservations
  FOR EACH ROW EXECUTE FUNCTION _trg_reservation_sold_out();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4b. Trigger sur reservation_appareils
--     → se déclenche quand des appareils sont assignés à une réservation
--       (INSERT lors de la confirmation du paiement) ou désassignés (DELETE).
--       Nécessaire car la confirmation de statut et l'assignation des appareils
--       se produisent dans le même appel API mais dans cet ordre précis.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _trg_res_app_sold_out()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_city_id bigint;
BEGIN
  SELECT r.city_id INTO v_city_id
  FROM reservations r
  WHERE r.id = COALESCE(NEW.reservation_id, OLD.reservation_id);

  IF v_city_id IS NOT NULL THEN
    PERFORM _auto_sold_out(v_city_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_res_app_sold_out ON reservation_appareils;
CREATE TRIGGER trg_res_app_sold_out
  AFTER INSERT OR DELETE ON reservation_appareils
  FOR EACH ROW EXECUTE FUNCTION _trg_res_app_sold_out();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4c. Trigger sur appareils
--     → se déclenche quand un appareil est ajouté (INSERT) ou son statut change
--       (panne, maintenance, retour en disponible).
--       Couvre les cas :
--       • nouvelle clim ajoutée dans le stock → sold_out peut passer à false
--       • clim tombée en panne → sold_out peut passer à true  (flotte réduite)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _trg_appareil_sold_out()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM _auto_sold_out(COALESCE(NEW.city_id, OLD.city_id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appareil_sold_out ON appareils;
CREATE TRIGGER trg_appareil_sold_out
  AFTER INSERT OR UPDATE OF statut ON appareils
  FOR EACH ROW EXECUTE FUNCTION _trg_appareil_sold_out();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Calcul initial : synchronise sold_out pour toutes les villes existantes
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM cities LOOP
    PERFORM _auto_sold_out(r.id);
  END LOOP;
END;
$$;
