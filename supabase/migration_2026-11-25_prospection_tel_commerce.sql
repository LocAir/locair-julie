-- Prospection terrain (25/11/2026) : deux numéros dans la convention.
-- tel          = portable du gérant (déjà existant)
-- tel_commerce = téléphone de l'établissement (nouveau, facultatif)
alter table prospection_points add column if not exists tel_commerce text;
