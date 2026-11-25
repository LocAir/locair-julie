-- Prospection terrain (25/11/2026) : SIRET de l'annuaire officiel, confirmé
-- par le commerçant (« C'est exact »), écrit dans sa convention.
alter table prospection_points add column if not exists siret text;
