-- Champ libre "informations supplémentaires" sur la fiche transporteur
-- (admin/index.html, modal "Modifier la fiche").
alter table transporteurs add column if not exists notes text;
