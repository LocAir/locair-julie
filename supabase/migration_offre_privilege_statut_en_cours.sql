-- Ajoute 'en_cours' à la contrainte offres_privilege.statut.
-- Sans ce correctif, le paiement de l'offre privilège retourne toujours
-- "Erreur serveur" : l'API essaie de poser un verrou atomique en passant
-- statut → 'en_cours', mais la contrainte de check le rejetait silencieusement.
alter table offres_privilege drop constraint if exists offres_privilege_statut_check;
alter table offres_privilege add constraint offres_privilege_statut_check
  check (statut in ('eligible', 'proposee', 'en_cours', 'acceptee', 'refusee', 'annulee'));
