-- Offre Privilège — facture de vente + remboursement dédié
--
-- 1) Ajoute le type de document "facture_vente" (facture émise pour l'achat
--    d'un climatiseur via l'Offre Privilège, distincte de "facture" qui reste
--    réservée aux locations) + son propre index unique par réservation, sur
--    le même modèle que documents_facture_unique_idx.
--
-- 2) Aucun changement de table nécessaire pour le remboursement : la table
--    "remboursements" existante (reservation_id) est réutilisée telle quelle,
--    l'offre étant elle-même rattachée à une reservation_id.

alter table documents drop constraint if exists documents_type_check;
alter table documents add constraint documents_type_check
  check (type in ('contrat', 'facture', 'facture_vente'));

create unique index if not exists documents_facture_vente_unique_idx
  on documents (reservation_id) where type = 'facture_vente';
