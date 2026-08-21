-- ══════════════════════════════════════════════════════════════════════════
--  LOC'AIR PRO — grille tarifaire des entreprises
--
--  À coller dans Supabase → SQL Editor, puis « Run ».
--
--  Le code déployé fonctionne AVANT comme APRÈS cette migration : tant que
--  ces colonnes n'existent pas, api/_lib/pricing.js retombe sur les mêmes
--  valeurs par défaut. Rien ne casse, rien ne change de prix.
--  Une fois collée, ces tarifs deviennent modifiables depuis la base sans
--  toucher au code.
--
--  Les seuils de jours (7 / 14 / 21) sont partagés avec la grille des
--  particuliers : seuls les tarifs et la durée minimale diffèrent.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE pricing_config
  ADD COLUMN IF NOT EXISTS pro_duree_min_jours      integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pro_palier1_tarif_cents  integer NOT NULL DEFAULT 4000,
  ADD COLUMN IF NOT EXISTS pro_palier2_tarif_cents  integer NOT NULL DEFAULT 3400,
  ADD COLUMN IF NOT EXISTS pro_palier3_tarif_cents  integer NOT NULL DEFAULT 3000,
  ADD COLUMN IF NOT EXISTS pro_palier4_tarif_cents  integer NOT NULL DEFAULT 2700,
  ADD COLUMN IF NOT EXISTS pro_forfait_cents        integer NOT NULL DEFAULT 12000;

COMMENT ON COLUMN pricing_config.pro_duree_min_jours     IS 'Durée minimale d''une location pro, en jours (1 : un événement peut durer une journée)';
COMMENT ON COLUMN pricing_config.pro_palier1_tarif_cents IS 'Tarif pro par jour, jours 1 à 7, en centimes';
COMMENT ON COLUMN pricing_config.pro_palier2_tarif_cents IS 'Tarif pro par jour, jours 8 à 14, en centimes';
COMMENT ON COLUMN pricing_config.pro_palier3_tarif_cents IS 'Tarif pro par jour, jours 15 à 21, en centimes';
COMMENT ON COLUMN pricing_config.pro_palier4_tarif_cents IS 'Tarif pro par jour, à partir du 22e, en centimes';
COMMENT ON COLUMN pricing_config.pro_forfait_cents       IS 'Forfait pro unique : livraison + installation + reprise. REMPLACE les frais de livraison et d''installation des particuliers, ne s''y ajoute pas.';

-- Vérification : la ligne doit exister et porter les six colonnes.
SELECT pro_duree_min_jours,
       pro_palier1_tarif_cents, pro_palier2_tarif_cents,
       pro_palier3_tarif_cents, pro_palier4_tarif_cents,
       pro_forfait_cents
FROM pricing_config WHERE id = 1;
