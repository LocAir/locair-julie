-- ================================================================
-- Correctif : fonction SQL bump_nb_locations_historique manquante.
--
-- api/admin-stock.js appelle supabase.rpc('bump_nb_locations_historique', ...)
-- depuis le 24/07 (échange/réaffectation manuelle d'un appareil) pour
-- préserver le compteur de locations d'un appareil qu'on retire d'une
-- réservation (sinon cette location "disparaît" du décompte utilisé pour
-- le seuil de maintenance ET pour l'éligibilité à l'Offre Privilège).
-- Cette fonction n'a jamais été livrée : l'appel RPC échoue silencieusement
-- (l'erreur n'est jamais vérifiée côté code), donc nb_locations_historique
-- ne s'incrémente jamais réellement — un appareil souvent échangé peut
-- sous-compter ses vraies locations.
--
-- À COLLER DANS SUPABASE → SQL EDITOR (une seule fois, sans risque à
-- rejouer — CREATE OR REPLACE)
-- ================================================================

create or replace function bump_nb_locations_historique(p_appareil_id bigint)
returns void
language sql
as $$
  update appareils set nb_locations_historique = nb_locations_historique + 1 where id = p_appareil_id;
$$;
