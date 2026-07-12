-- Coordonnées bancaires du partenaire (conciergerie), saisies une fois par
-- l'admin et réutilisées à chaque virement — le paiement reste manuel pour
-- l'instant (aucune app de paiement instantané branchée), mais le RIB est
-- déjà là pour ne pas avoir à le redemander, et pour brancher plus tard un
-- vrai virement automatisé sans tout reconstruire. Idempotent — sans risque
-- à rejouer, y compris si migration_partenaires.sql n'a pas encore été
-- appliquée (les deux commandes plus bas échoueraient alors avec une erreur
-- claire "relation partenaires does not exist" — jouer migration_partenaires.sql
-- d'abord).
alter table partenaires add column if not exists titulaire_compte text;
alter table partenaires add column if not exists iban text;
alter table partenaires add column if not exists bic text;
