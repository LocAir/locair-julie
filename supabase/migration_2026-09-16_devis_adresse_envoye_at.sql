-- Suite de l'audit du module Devis (demande d'Aly, 2026-09-16) :
--   1. `adresse` — aucun champ de livraison n'existait sur un devis, alors
--      qu'une réservation en a besoin pour de vrai. "Convertir en
--      réservation" ne pouvait donc jamais la pré-remplir.
--   2. `envoye_at` — le compteur "en attente depuis X jours" (admin/index.html
--      devisAgeHtml, et le rappel quotidien de api/cron-daily.js) se basait
--      jusqu'ici sur `created_at`, pas sur la date d'envoi réelle : un devis
--      resté plusieurs jours en brouillon avant d'être envoyé affichait déjà
--      un délai écoulé au moment même de l'envoi.
alter table devis add column if not exists adresse text;
alter table devis add column if not exists envoye_at timestamptz;

-- Comble envoye_at pour les devis DÉJÀ envoyés avant cette migration — sans
-- ça, le rappel quotidien (qui filtre maintenant sur envoye_at) arrêterait
-- de relancer ces devis existants du jour au lendemain (envoye_at NULL ne
-- matche jamais un filtre "plus vieux que X jours"). Repli raisonnable :
-- created_at reste la meilleure estimation disponible pour ces lignes-là.
update devis set envoye_at = created_at where statut = 'envoye' and envoye_at is null;
