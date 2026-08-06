-- ================================================================
-- Panneau de contrôle des tarifs de location (Aly peut changer le prix
-- du site sans passer par un développeur) — remplace les valeurs jusqu'ici
-- écrites en dur dans api/_lib/pricing.js (12/10/9/8 €/jour, paliers
-- 7/14/21 jours), qui étaient aussi recopiées à la main à ~37 endroits
-- (site public, contrat PDF, CGV, page retard) : source unique désormais,
-- tout le reste va la lire au lieu de dupliquer les chiffres.
--
-- Ligne unique (id=1), même pattern que email_signature/assistance_config.
-- Tarifs global au site (pas par ville) — décision explicite d'Aly.
--
-- À COLLER DANS SUPABASE → SQL EDITOR (une seule fois, sans risque à
-- rejouer)
-- ================================================================

create table if not exists pricing_config (
  id                    integer primary key default 1,
  duree_min_jours       integer not null default 7,
  -- Palier 1 : jours 1 à palier1_max_jours, au tarif palier1_tarif_cents.
  palier1_max_jours     integer not null default 7,
  palier1_tarif_cents   integer not null default 1200,
  -- Palier 2 : jours (palier1_max_jours+1) à palier2_max_jours.
  palier2_max_jours     integer not null default 14,
  palier2_tarif_cents   integer not null default 1000,
  -- Palier 3 : jours (palier2_max_jours+1) à palier3_max_jours.
  palier3_max_jours     integer not null default 21,
  palier3_tarif_cents   integer not null default 900,
  -- Palier 4 : tous les jours au-delà de palier3_max_jours, sans limite.
  palier4_tarif_cents   integer not null default 800,
  updated_at            timestamptz not null default now(),
  constraint pricing_config_single_row check (id = 1),
  constraint pricing_config_paliers_croissants check (
    palier1_max_jours < palier2_max_jours and palier2_max_jours < palier3_max_jours
  )
);
insert into pricing_config (id) values (1) on conflict (id) do nothing;
