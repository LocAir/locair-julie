-- ================================================================
-- Correctif CRITIQUE : fonction consume_challenge manquante — Face ID
-- entièrement cassé (admin ET transporteur) depuis le commit "audit
-- massif" de ce matin (2026-08-03, 01h55).
--
-- Ce commit a changé api/_lib/webauthn.js pour consommer le challenge via
-- un appel RPC atomique (supabase.rpc('consume_challenge', ...)) afin de
-- corriger un vrai bug (SELECT puis DELETE séparés → un challenge pouvait
-- être rejoué deux fois). Mais la fonction SQL correspondante n'a jamais
-- été livrée : chaque appel échoue ("function does not exist"), donc
-- CHAQUE tentative de connexion/inscription Face ID (admin et
-- transporteur) échoue silencieusement — seul le code PIN fonctionne
-- encore.
--
-- À COLLER DANS SUPABASE → SQL EDITOR (une seule fois, sans risque à
-- rejouer — CREATE OR REPLACE)
-- ================================================================

create or replace function consume_challenge(p_challenge text)
returns boolean
language plpgsql
security definer
as $$
declare
  v_id bigint;
begin
  delete from webauthn_challenges
  where challenge = p_challenge
    and created_at > now() - interval '5 minutes'
  returning id into v_id;
  return v_id is not null;
end;
$$;
