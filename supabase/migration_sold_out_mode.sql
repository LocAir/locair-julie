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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Alerte admin dès qu'une ville affiche "complet" (une seule fois par
--    épisode) : sold_out_notified passe à true côté application (api/_lib/
--    city.js, notifyIfSoldOut) juste après l'envoi du push. Ce trigger se
--    charge uniquement de le réinitialiser à false dès que la ville redevient
--    disponible — que ce soit via le calcul automatique ou une réouverture
--    manuelle — pour que la prochaine fermeture déclenche une nouvelle alerte.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE cities ADD COLUMN IF NOT EXISTS sold_out_notified boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION _reset_sold_out_notified()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sold_out = false THEN
    NEW.sold_out_notified := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_sold_out_notified ON cities;
CREATE TRIGGER trg_reset_sold_out_notified
  BEFORE UPDATE OF sold_out ON cities
  FOR EACH ROW EXECUTE FUNCTION _reset_sold_out_notified();
