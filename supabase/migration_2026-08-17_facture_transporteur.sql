-- Facture hebdomadaire d'un transporteur à destination de Loc'Air (demande
-- d'Aly, 2026-08-17) : un transporteur est un prestataire indépendant (auto-
-- entrepreneur) qui facture Loc'Air pour ses missions — le sens est donc
-- INVERSÉ par rapport à la table "documents" existante (contrat/facture du
-- CLIENT vers Loc'Air). Table séparée plutôt qu'un nouveau "type" dans
-- documents : documents.reservation_id est "not null" (1 document = 1
-- réservation) alors qu'une facture transporteur couvre une semaine entière,
-- potentiellement plusieurs dizaines de missions sur plusieurs réservations.
--
-- Fichiers stockés dans le même bucket "missions" que le reste des documents
-- (préfixe documents/factures-transporteurs/) — aucun nouveau bucket/policy
-- Supabase Storage nécessaire.
--
-- Pas de numérotation séquentielle façon "facture_compteur" : ce n'est pas
-- la série légale de factures ÉMISES PAR Loc'Air (obligation de continuité),
-- mais un document généré par commodité pour le compte du transporteur —
-- son numéro (FACT-TR{id}-{date}) est simplement déterministe et unique,
-- garanti par l'index unique ci-dessous (1 facture par transporteur et par
-- semaine exacte, jamais de doublon même en cas de double clic).
create table if not exists transporteur_factures (
  id                   bigint generated always as identity primary key,
  transporteur_id      bigint not null references transporteurs(id) on delete cascade,
  numero               text not null unique,
  periode_debut        date not null,
  periode_fin          date not null,
  nb_missions          integer not null default 0,
  montant_total_cents  integer not null default 0,
  storage_path         text not null,
  access_token         text not null unique,
  -- Statut de l'envoi automatique par email à l'administration — la facture
  -- reste générée et consultable (transporteur + admin) même si l'email a
  -- échoué, jamais bloquant (voir _lib/transporteurFacture.js).
  envoyee_admin        boolean not null default false,
  envoyee_erreur        text,
  created_at           timestamptz not null default now()
);
create unique index if not exists transporteur_factures_periode_unique_idx
  on transporteur_factures (transporteur_id, periode_debut, periode_fin);
create index if not exists transporteur_factures_transporteur_idx
  on transporteur_factures (transporteur_id, periode_debut desc);
create index if not exists transporteur_factures_access_token_idx
  on transporteur_factures (access_token);

-- Informations facultatives nécessaires pour émettre une facture légale
-- correcte (le transporteur facture Loc'Air en tant qu'auto-entrepreneur) —
-- restent NULL tant qu'elles ne sont pas renseignées par l'admin sur la
-- fiche transporteur ; le PDF affiche alors une mention "non renseigné"
-- plutôt que de bloquer la génération de la facture.
alter table transporteurs add column if not exists siret text;
alter table transporteurs add column if not exists adresse_facturation text;
