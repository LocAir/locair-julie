-- Click & Collect — retour de l'appareil au point de retrait.
-- À coller UNE FOIS dans Supabase → SQL Editor (aucun effet tout seul en prod).
--
-- Le code déjà en ligne marche sans ces colonnes : il se replie (pas de
-- bouton « Confirmer le retour » utilisable, pas d'alerte « retour en
-- retard »). Après la migration, le commerçant confirme le retour en
-- scannant le QR code du client (api/partenaire-remise.js, action 'rendre').

-- Sécurité : colonnes de la migration du 18/11 (remise au client), au cas
-- où elle n'aurait pas encore été passée. Sans effet si elles existent.
alter table reservations add column if not exists remis_at timestamptz;
alter table reservations add column if not exists remis_par_partenaire_id bigint references partenaires(id);

-- 1. Date et heure du retour de l'appareil au point (confirmé par le commerçant).
alter table reservations add column if not exists rendu_at timestamptz;

-- 2. Commerçant qui a confirmé le retour.
alter table reservations add column if not exists rendu_par_partenaire_id bigint references partenaires(id);

-- 3. Pour retrouver vite les appareils pas encore rendus (alerte retard, cron).
create index if not exists reservations_cc_non_rendus_idx on reservations (date_fin)
  where source_channel = 'click_collect' and rendu_at is null;

-- 4. Scénarios d'envoi Click & Collect. La table email_sent (verrou « jamais
--    deux fois ») a une clé étrangère vers email_scenarios : un scénario
--    absent de cette liste n'est JAMAIS envoyé (l'insert du verrou échoue en
--    silence). C'était le cas de l'email de confirmation Click & Collect.
insert into email_scenarios (id, libelle) values
  ('confirmation_click_collect', 'Click & Collect — confirmation (QR code de retrait)'),
  ('cc_rappel_retrait',          'Click & Collect — rappel la veille du retrait'),
  ('cc_rappel_retour',           'Click & Collect — rappel la veille du retour')
on conflict (id) do nothing;
