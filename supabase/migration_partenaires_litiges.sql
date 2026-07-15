-- Réconciliation : une réservation confirmée dont la commission partenaire a
-- déjà été versée peut ensuite être annulée ou remboursée (client qui se
-- désiste, litige...) — l'argent est alors sorti mais le service n'a
-- finalement pas eu lieu. Cette colonne permet à l'admin de dire "je me suis
-- occupé de ça" (récupéré auprès du partenaire, ou déduit du prochain
-- virement) sans qu'il y ait de logique automatique qui retouche l'argent
-- déjà versé. Idempotent — sans risque à rejouer, y compris si
-- migration_partenaires.sql n'a pas encore été appliquée (jouer
-- migration_partenaires.sql d'abord sinon).
alter table reservations add column if not exists partenaire_litige_resolu boolean not null default false;
