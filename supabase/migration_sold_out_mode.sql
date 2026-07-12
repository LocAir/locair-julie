-- ─────────────────────────────────────────────────────────────────────────────
-- Migration : mode manuel/automatique pour le "complet" (sold_out) d'une ville
-- À exécuter dans Supabase → SQL Editor (une seule fois)
-- Dépend de migration_auto_sold_out.sql (déjà exécutée)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Colonne de mode : 'auto' (par défaut, calculé automatiquement à partir
--    du stock réel) ou 'manuel' (l'admin garde la main, ex. incident,
--    contrôle qualité, fermeture temporaire volontaire).
ALTER TABLE cities ADD COLUMN IF NOT EXISTS sold_out_mode text NOT NULL DEFAULT 'auto'
  CHECK (sold_out_mode IN ('auto', 'manuel'));

-- 2. _auto_sold_out ne touche plus sold_out pour une ville en mode "manuel" —
--    l'admin garde la main jusqu'à repasser la ville en mode automatique.
CREATE OR REPLACE FUNCTION _auto_sold_out(p_city_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_total       int;
  v_en_location int;
  v_mode        text;
BEGIN
  SELECT sold_out_mode INTO v_mode FROM cities WHERE id = p_city_id;
  IF v_mode = 'manuel' THEN
    RETURN;
  END IF;

  -- Appareils actifs dans cette ville (hors panne/maintenance)
  SELECT COUNT(*) INTO v_total
  FROM appareils
  WHERE city_id = p_city_id AND statut = 'disponible';

  -- Appareils actuellement chez un client
  -- (réservation confirmée qui couvre aujourd'hui)
  SELECT COUNT(DISTINCT ra.appareil_id) INTO v_en_location
  FROM reservation_appareils ra
  JOIN reservations r ON ra.reservation_id = r.id
  WHERE r.city_id    = p_city_id
    AND r.statut     = 'confirmee'
    AND r.date_debut <= CURRENT_DATE
    AND r.date_fin   >  CURRENT_DATE;

  -- 100 % occupé (ou aucun appareil actif) → sold_out
  UPDATE cities
  SET sold_out = (v_total = 0 OR v_en_location >= v_total)
  WHERE id = p_city_id;
END;
$$;
