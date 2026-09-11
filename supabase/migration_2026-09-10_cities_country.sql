-- Multi-pays (demande d'Aly, 2026-09-10) — jusqu'ici "cities" ne portait
-- aucune notion de pays (dep = département français, sans équivalent
-- ailleurs). Madrid, Rome et les prochaines capitales ont besoin d'un code
-- pays pour s'afficher correctement dans l'admin (drapeau + regroupement).
-- Toutes les villes existantes (Nice, Cannes, Antibes, Monaco, Menton)
-- passent en 'FR' par défaut — aucun changement de comportement pour elles.
alter table cities add column if not exists country_code text not null default 'FR';
