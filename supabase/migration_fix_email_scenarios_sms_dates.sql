-- ================================================================
-- Correctif : mettre en pause sms_relance_prolongation ou
-- sms_rappel_recuperation depuis une fiche client échoue.
--
-- api/_lib/communicationsCockpit.js traite ces 2 SMS exactement comme les
-- scénarios email du moteur (même bouton pause/reprendre, même mécanisme
-- email_skip) — mais email_skip.scenario a une clé étrangère vers
-- email_scenarios(id), et ces 2 identifiants n'y ont jamais été ajoutés.
-- Résultat : cliquer "Mettre en pause" ou "Supprimer" sur une de ces 2
-- lignes dans la fiche client échoue (contrainte de clé étrangère
-- violée), api/admin-emails.js renvoie "Erreur serveur" sans que l'admin
-- comprenne pourquoi, et la pause n'est jamais appliquée.
--
-- À COLLER DANS SUPABASE → SQL EDITOR (une seule fois, sans risque à
-- rejouer — ON CONFLICT DO NOTHING)
-- ================================================================

insert into email_scenarios (id, libelle) values
  ('sms_relance_prolongation', 'SMS proposition de prolongation (J-4)'),
  ('sms_rappel_recuperation',  'SMS rappel récupération (J-1)')
on conflict (id) do nothing;
