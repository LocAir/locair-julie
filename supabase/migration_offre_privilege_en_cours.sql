-- ================================================================
-- OFFRE PRIVILÈGE — correctif : statut "en_cours" manquant.
--
-- Bug (2026-08-03) : quand le client clique "Je le garde — payer
-- maintenant", offre-privilege-pay.js verrouille l'offre en la passant à
-- 'en_cours' (pour empêcher un double-clic de créer deux paiements Stripe
-- pour la même offre) — mais cette valeur n'a jamais été ajoutée à la
-- contrainte check d'origine (offres_privilege_statut_check), qui n'autorise
-- que 'eligible', 'proposee', 'acceptee', 'refusee', 'annulee'. Résultat :
-- l'UPDATE échoue en base à chaque tentative de paiement, et le client voit
-- systématiquement "Erreur serveur" au moment de payer — l'Offre Privilège
-- n'a donc jamais pu être achetée en ligne depuis sa mise en place.
--
-- À COLLER DANS SUPABASE → SQL EDITOR (une seule fois, sans risque à rejouer)
-- ================================================================

alter table offres_privilege drop constraint if exists offres_privilege_statut_check;
alter table offres_privilege add constraint offres_privilege_statut_check
  check (statut in ('eligible', 'proposee', 'en_cours', 'acceptee', 'refusee', 'annulee'));
