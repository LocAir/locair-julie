-- ================================================================
-- MODULE 7 (suite) — Statut de commande détaillé (Partie 7, statuts).
-- IMPORTANT : ceci est une colonne d'AFFICHAGE en plus, pas un
-- remplacement de reservations.statut. reservations.statut (5 valeurs :
-- en_attente/confirmee/annulee/terminee/remboursee) continue de piloter
-- SANS AUCUN CHANGEMENT le paiement Stripe, les remboursements et les
-- commissions partenaires — bien trop risqué à modifier directement (voir
-- l'audit qui a précédé cette migration : 8 endroits liés à l'argent en
-- dépendent). statut_detaille se contente de refléter, pour l'affichage
-- (admin, client), le cycle de vie en 9 étapes réellement automatisées
-- parmi les 11 du Module 7 — recalculé à partir des mêmes données que
-- computeOrderStatus (_lib/orderStatus.js), jamais l'inverse.
--
-- 'paiement_recu', 'verification_en_cours' et 'prolongation_demandee' sont
-- acceptées par la contrainte (vocabulaire du Module 7) mais aucun code ne
-- les pose encore automatiquement : le paiement Stripe confirme directement
-- la réservation dans le même geste (pas d'étape intermédiaire "payé mais
-- pas encore vérifié" dans le fonctionnement actuel), et une prolongation
-- est une réservation séparée, pas un changement d'état de la réservation
-- d'origine. Ces trois valeurs restent disponibles pour un futur réglage
-- manuel (fiche commande) sans nouvelle migration.
-- ================================================================

alter table reservations add column statut_detaille text
  check (statut_detaille in (
    'nouvelle_demande', 'paiement_recu', 'verification_en_cours', 'confirmee',
    'preparation', 'livraison_prevue', 'en_location', 'prolongation_demandee',
    'retour_prevu', 'terminee', 'annulee', 'remboursee'
  ));

-- Amorce raisonnable pour les réservations déjà en base — sera affinée dès
-- la prochaine lecture (liste admin ou tableau de bord client), qui
-- recalcule et réenregistre la vraie valeur détaillée.
update reservations set statut_detaille = case statut
  when 'en_attente' then 'nouvelle_demande'
  when 'confirmee'  then 'confirmee'
  when 'annulee'    then 'annulee'
  when 'terminee'   then 'terminee'
  when 'remboursee' then 'remboursee'
  else null
end;
