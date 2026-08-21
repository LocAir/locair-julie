-- ══════════════════════════════════════════════════════════════════════════
--  LOC'AIR PRO — grille tarifaire des entreprises
--
--  À COLLER EN UNE SEULE FOIS dans Supabase → SQL Editor, puis « Run ».
--  Sans risque à rejouer : tout est en « if not exists ».
--
--  POURQUOI CE SCRIPT FAIT DEUX CHOSES
--  La table pricing_config n'a jamais été créée en production : le fichier
--  migration_pricing_config.sql existe dans le dépôt mais n'a pas été collé.
--  Personne ne s'en est aperçu parce que api/_lib/pricing.js retombe
--  silencieusement sur les mêmes tarifs (12/10/9/8 €) quand la table manque.
--  Le site a donc toujours affiché les bons prix — mais le panneau de
--  contrôle des tarifs de l'admin n'a jamais rien pu enregistrer.
--
--  Étape 1 : on crée la table avec les tarifs actuels (aucun prix ne change).
--  Étape 2 : on y ajoute la grille pro.
-- ══════════════════════════════════════════════════════════════════════════

-- ── ÉTAPE 1 · la table des tarifs, si elle n'existe pas encore ────────────
create table if not exists pricing_config (
  id                    integer primary key default 1,
  duree_min_jours       integer not null default 7,
  palier1_max_jours     integer not null default 7,
  palier1_tarif_cents   integer not null default 1200,   -- 12 €/jour
  palier2_max_jours     integer not null default 14,
  palier2_tarif_cents   integer not null default 1000,   -- 10 €/jour
  palier3_max_jours     integer not null default 21,
  palier3_tarif_cents   integer not null default 900,    --  9 €/jour
  palier4_tarif_cents   integer not null default 800,    --  8 €/jour
  updated_at            timestamptz not null default now(),
  constraint pricing_config_single_row check (id = 1),
  constraint pricing_config_paliers_croissants check (
    palier1_max_jours < palier2_max_jours and palier2_max_jours < palier3_max_jours
  )
);
insert into pricing_config (id) values (1) on conflict (id) do nothing;

-- ── ÉTAPE 2 · la grille pro ───────────────────────────────────────────────
-- Les seuils de jours (7 / 14 / 21) sont partagés avec les particuliers :
-- seuls les tarifs et la durée minimale diffèrent. Un événement peut durer
-- une seule journée, une location particulier non.
alter table pricing_config
  add column if not exists pro_duree_min_jours      integer not null default 1,
  add column if not exists pro_palier1_tarif_cents  integer not null default 4000,   -- 40 €/jour
  add column if not exists pro_palier2_tarif_cents  integer not null default 3400,   -- 34 €/jour
  add column if not exists pro_palier3_tarif_cents  integer not null default 3000,   -- 30 €/jour
  add column if not exists pro_palier4_tarif_cents  integer not null default 2700,   -- 27 €/jour
  add column if not exists pro_forfait_cents        integer not null default 12000;  -- 120 € une fois

comment on column pricing_config.pro_duree_min_jours     is 'Durée minimale d''une location pro, en jours';
comment on column pricing_config.pro_palier1_tarif_cents is 'Tarif pro par jour, jours 1 à 7, en centimes';
comment on column pricing_config.pro_palier2_tarif_cents is 'Tarif pro par jour, jours 8 à 14, en centimes';
comment on column pricing_config.pro_palier3_tarif_cents is 'Tarif pro par jour, jours 15 à 21, en centimes';
comment on column pricing_config.pro_palier4_tarif_cents is 'Tarif pro par jour, à partir du 22e, en centimes';
comment on column pricing_config.pro_forfait_cents       is 'Forfait pro unique : livraison + installation + reprise. REMPLACE les frais de livraison et d''installation des particuliers, il ne s''y ajoute pas.';

-- ── VÉRIFICATION ──────────────────────────────────────────────────────────
-- Doit renvoyer UNE ligne. Les tarifs particuliers doivent valoir
-- 1200 / 1000 / 900 / 800, et les tarifs pro 4000 / 3400 / 3000 / 2700.
select duree_min_jours,
       palier1_tarif_cents, palier2_tarif_cents, palier3_tarif_cents, palier4_tarif_cents,
       pro_duree_min_jours,
       pro_palier1_tarif_cents, pro_palier2_tarif_cents,
       pro_palier3_tarif_cents, pro_palier4_tarif_cents,
       pro_forfait_cents
from pricing_config
where id = 1;
