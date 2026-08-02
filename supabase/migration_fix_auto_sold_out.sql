-- ─────────────────────────────────────────────────────────────────────────────
-- Correctif : _auto_sold_out comptait certains appareils loués deux fois
-- (audit automatisations, 2026-08-02) — plus une ville a de climatiseurs
-- sortis chez des clients, plus le calcul devenait faux et pessimiste,
-- pouvant afficher "Complet" (badge admin + alerte push) alors qu'il reste
-- réellement des appareils libres.
--
-- Bug : v_total ne comptait que statut='disponible' (donc jamais les
-- appareils déjà 'loue'), alors que v_en_location comptait TOUS les
-- appareils en cours de location (quel que soit leur statut) — un appareil
-- loué était donc soustrait "en double" : absent de v_total ET compté dans
-- v_en_location, faisant chuter le calcul à zéro dès qu'il y a du monde.
--
-- Corrigé : v_total compte tous les appareils actifs du parc (hors
-- panne/maintenance/vendu), conforme au commentaire d'origine de la
-- fonction — même principe déjà appliqué à available_units (fonction
-- jumelle qui gère le blocage réel du site en mode auto, jamais affectée
-- par ce bug).
--
-- Sans effet sur le blocage du site public (api/mode-complet.js recalcule
-- toujours en direct via available_units, jamais via ce champ mis en
-- cache) — corrige uniquement le badge "Complet" de l'admin (onglet
-- Villes) et l'alerte push associée (notifyIfSoldOut).
--
-- À COLLER DANS SUPABASE → SQL EDITOR (une seule fois, sans risque à rejouer)
-- ─────────────────────────────────────────────────────────────────────────────

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

  -- Appareils actifs dans cette ville (hors panne/maintenance/vendu) —
  -- inclut bien ceux actuellement loués, contrairement à l'ancienne version.
  SELECT COUNT(*) INTO v_total
  FROM appareils
  WHERE city_id = p_city_id AND statut NOT IN ('panne', 'maintenance', 'vendu');

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
