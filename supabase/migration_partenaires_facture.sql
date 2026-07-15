-- Une commission versée à un partenaire (conciergerie...) est une prestation
-- entre deux entreprises : elle devrait normalement donner lieu à une facture
-- de sa part. Cette colonne ne bloque jamais le virement (le paiement reste
-- manuel, décidé par le propriétaire) — elle sert juste de pense-bête pour ne
-- pas perdre le fil de qui a déjà envoyé sa facture. Idempotent — sans risque
-- à rejouer, y compris si migration_partenaires.sql n'a pas encore été
-- appliquée (jouer migration_partenaires.sql d'abord sinon).
alter table partenaire_virements add column if not exists facture_recue boolean not null default false;
