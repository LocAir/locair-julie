-- Suite de la facture hebdomadaire transporteur (migration_2026-08-17_
-- facture_transporteur.sql, déjà appliquée) : automatisation du lundi
-- (rappel, puis génération automatique si oublié) — demande d'Aly.
--
-- Les notifications transporteur (transporteur_notifications) ont une
-- liste fermée de "type" autorisés — 'facture' n'en fait pas encore
-- partie, nécessaire pour distinguer ces rappels/générations automatiques
-- dans le centre de notifications du transporteur (et pour ne PAS
-- déclencher les effets de bord attachés à d'autres types existants,
-- ex. le SMS automatique attaché à 'paiement' — voir _lib/transporteurNotif.js).
alter table transporteur_notifications drop constraint transporteur_notifications_type_check;
alter table transporteur_notifications add constraint transporteur_notifications_type_check
  check (type in ('nouvelle_mission','modification','annulation','incident','validation','paiement','facture'));
