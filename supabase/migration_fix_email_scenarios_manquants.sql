-- ================================================================
-- Correctif CRITIQUE : 4 communications clients bloquées silencieusement
-- depuis le commit "audit massif" de ce matin (2026-08-03, 01h55).
--
-- Ce commit a changé le verrou anti-doublon d'envoi de plusieurs
-- communications ponctuelles (hors moteur des 8 scénarios email) : au lieu
-- d'un SELECT sur email_log (sans contrainte), le code fait maintenant un
-- INSERT dans email_sent, où la colonne "scenario" a une clé étrangère
-- vers email_scenarios(id) — un changement voulu et correct pour éviter un
-- vrai risque de double-envoi, mais les 4 valeurs suivantes n'ont jamais
-- été ajoutées à cette table de référence :
--   - sms_confirmation   (api/_lib/reservations.js — SMS à la confirmation
--     d'une nouvelle réservation)
--   - email_prolongation (api/_lib/reservations.js — email de confirmation
--     d'une prolongation)
--   - sms_prolongation   (api/_lib/reservations.js — SMS de confirmation
--     d'une prolongation)
--   - sms_avis_google    (api/cron-sms-avis.js — SMS de demande d'avis
--     Google après récupération)
--
-- Résultat : chaque INSERT viole la contrainte de clé étrangère, le code
-- traite CETTE erreur comme "un autre processus a déjà pris le verrou" et
-- annule l'envoi sans rien logger — ces 4 communications ne partent plus
-- du tout depuis ce matin, sans que rien ne le signale nulle part.
--
-- À COLLER DANS SUPABASE → SQL EDITOR (une seule fois, sans risque à
-- rejouer — ON CONFLICT DO NOTHING)
-- ================================================================

insert into email_scenarios (id, libelle) values
  ('sms_confirmation',   'SMS de confirmation de réservation'),
  ('email_prolongation', 'Email de confirmation de prolongation'),
  ('sms_prolongation',   'SMS de confirmation de prolongation'),
  ('sms_avis_google',    'SMS de demande d''avis Google')
on conflict (id) do nothing;
