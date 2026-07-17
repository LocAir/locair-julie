-- Tarif transporteur fixé à la main pour une mission précise (ex. mission
-- hors zone payée 95€ au lieu du barème standard) — si true, le passage au
-- statut "fait" (api/transporteur-action.js) ne recalcule plus
-- livraisons.montant_du_cents automatiquement, il garde la valeur posée par
-- l'admin.
alter table livraisons add column if not exists montant_manuel boolean not null default false;
