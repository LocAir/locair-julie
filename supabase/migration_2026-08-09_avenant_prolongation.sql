-- Avenant de prolongation
--
-- Ajoute le type de document "avenant" : à chaque prolongation payée sur
-- Stripe, un avenant PDF (qui modifie la date de fin du contrat de location
-- d'origine, sans le réémettre en entier) est maintenant généré à la place
-- de l'ancien comportement (contrat entier réédité) — voir
-- api/_lib/documents.js (generateAndSendDocumentsAfterProlongation) et
-- api/_lib/pdf.js (generateAvenantProlongationPdf).
--
-- Pas d'index unique par reservation_id (contrairement à "facture"/
-- "facture_vente") : plusieurs prolongations successives du même dossier
-- créent chacune leur propre avenant numéroté (1, 2, 3...), tous rattachés
-- à la réservation d'origine.

alter table documents drop constraint if exists documents_type_check;
alter table documents add constraint documents_type_check
  check (type in ('contrat', 'facture', 'facture_vente', 'avenant'));
