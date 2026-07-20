-- ─────────────────────────────────────────────────────────────────────────────
-- Migration : compteur de secours pour l'Offre Privilège (nb_locations)
-- À exécuter dans Supabase → SQL Editor (une seule fois)
--
-- nb_locations (seuil d'éligibilité Offre Privilège) se calcule en comptant
-- les lignes reservation_appareils d'un appareil. Or admin-stock.js action
-- "reassign" (échange/réaffectation d'un climatiseur) SUPPRIME la ligne de
-- l'ancien appareil pour garder l'état "actuel" propre — ce qui effaçait
-- silencieusement cette location du décompte. Cette colonne garde le compte
-- des locations perdues de cette façon, additionné au décompte "actuel" par
-- le code (voir bumpNbLocationsHistorique dans api/admin-stock.js).
-- ─────────────────────────────────────────────────────────────────────────────

alter table appareils add column if not exists nb_locations_historique integer not null default 0;
