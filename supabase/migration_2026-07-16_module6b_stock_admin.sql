-- ================================================================
-- MODULE 6 (suite) — Administration du parc, rentabilité, alertes
-- (Parties 9 à 14). Seule vraie addition de schéma : le coût de
-- maintenance, quand l'admin le renseigne — tout le reste (tableau de
-- bord, filtres, fiche appareil, statistiques, alertes) se calcule à
-- la volée depuis les tables déjà créées par le Module 6.
-- ================================================================

alter table appareil_mouvements add column cout_cents integer check (cout_cents is null or cout_cents >= 0);
