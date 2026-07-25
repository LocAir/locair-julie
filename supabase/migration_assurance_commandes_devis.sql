-- Suivi assurance/sinistres, commandes fournisseurs et devis entreprises.
-- Idempotent — sans risque à rejouer.
--
-- À COLLER DANS SUPABASE → SQL EDITOR AVANT D'UTILISER CES 3 FONCTIONNALITÉS
-- (bouton "🛡️ Assurance" sur les incidents, section "Commandes fournisseurs"
-- de l'onglet Stock, onglet "Devis") — sans ce SQL, elles restent inertes
-- (aucun crash ailleurs dans l'admin, le site ou l'app transporteur).

-- 1. Suivi assurance/sinistres (nouvelles colonnes sur incidents)
alter table incidents add column if not exists assurance_statut text
  check (assurance_statut in ('non_declare','declare','en_attente_reponse','remboursee','refusee'));
alter table incidents add column if not exists assurance_montant_reclame_cents integer
  check (assurance_montant_reclame_cents is null or assurance_montant_reclame_cents >= 0);
alter table incidents add column if not exists assurance_montant_rembourse_cents integer
  check (assurance_montant_rembourse_cents is null or assurance_montant_rembourse_cents >= 0);
alter table incidents add column if not exists assurance_date_declaration date;
alter table incidents add column if not exists assurance_notes text;

-- 2. Commandes fournisseurs (nouvelle table)
create table if not exists commandes_fournisseur (
  id                    bigint generated always as identity primary key,
  city_id               bigint not null references cities(id),
  fournisseur           text not null,
  quantite              integer not null check (quantite > 0),
  montant_cents         integer not null default 0 check (montant_cents >= 0),
  date_commande         date not null default current_date,
  date_livraison_prevue date,
  date_livraison_reelle date,
  statut                text not null default 'commande'
                          check (statut in ('commande','en_transit','livree','annulee')),
  notes                 text,
  created_at            timestamptz not null default now()
);
create index if not exists commandes_fournisseur_city_idx on commandes_fournisseur (city_id, statut);

-- 3. Devis entreprises (nouvelle table)
create table if not exists devis (
  id               bigint generated always as identity primary key,
  city_id          bigint not null references cities(id),
  prenom           text,
  nom              text,
  raison_sociale   text not null,
  siret            text,
  email            text not null,
  tel              text,
  date_debut       date,
  date_fin         date,
  quantite         integer not null default 1 check (quantite > 0),
  installation     text,
  prix_propose_cents integer not null default 0,
  statut           text not null default 'brouillon'
                     check (statut in ('brouillon','envoye','accepte','refuse','expire')),
  notes            text,
  created_at       timestamptz not null default now()
);
create index if not exists devis_city_idx on devis (city_id, statut);
