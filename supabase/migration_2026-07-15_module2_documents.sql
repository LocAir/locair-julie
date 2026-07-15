-- Module 2 — Documents automatiques (contrat + facture PDF)
-- À coller dans Supabase → SQL Editor AVANT de merger la PR correspondante.
-- Ce script est idempotent (ré-exécutable sans risque si déjà appliqué).

-- 1. Documents générés (contrat, facture) — une ligne par document, jamais
--    régénérée pour une facture déjà existante (contrainte unique ci-dessous).
create table if not exists documents (
  id                bigint generated always as identity primary key,
  reservation_id    bigint not null references reservations(id) on delete cascade,
  type              text not null check (type in ('contrat','facture')),
  numero            text,               -- numéro de facture séquentiel (facture uniquement)
  version           text not null,      -- version des documents légaux (CGV_VERSION) à la génération
  storage_path      text not null,      -- chemin dans le bucket existant "missions"
  access_token      text not null unique, -- lien de consultation envoyé au client (jamais le storage_path brut)
  montant_ttc_cents integer not null default 0,
  statut            text not null default 'genere' check (statut in ('genere','envoye','consulte')),
  genere_at         timestamptz not null default now(),
  envoye_at         timestamptz,
  consulte_at       timestamptz,
  created_at        timestamptz not null default now()
);
-- Garantit qu'une seule facture existe jamais par réservation, y compris en
-- cas de redélivrance du webhook Stripe ou d'appel concurrent.
create unique index if not exists documents_facture_unique_idx on documents (reservation_id) where type = 'facture';
create index if not exists documents_reservation_idx on documents (reservation_id);
create index if not exists documents_access_token_idx on documents (access_token);

-- 2. Numérotation séquentielle des factures, par année, sans rupture — verrou
--    de ligne via ON CONFLICT DO UPDATE (atomique même en cas d'appels
--    concurrents, deux paiements confirmés à la même seconde par exemple).
create table if not exists facture_compteur (
  annee          integer primary key,
  dernier_numero integer not null default 0
);

create or replace function next_invoice_number(p_annee integer) returns integer
language plpgsql as $$
declare
  v_numero integer;
begin
  insert into facture_compteur (annee, dernier_numero) values (p_annee, 1)
    on conflict (annee) do update set dernier_numero = facture_compteur.dernier_numero + 1
  returning dernier_numero into v_numero;
  return v_numero;
end;
$$;
