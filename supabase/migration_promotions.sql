-- ================================================================
-- OFFRES & PROMOTIONS — table générique pour piloter depuis l'admin tous
-- les codes promo et réductions marketing, sans jamais avoir à toucher au
-- code ni à redéployer.
--
-- Remplace, avec un filet de sécurité tant qu'aucune ligne équivalente
-- n'existe (voir api/_lib/promotions.js) :
--   - PROMO_CODES codé en dur dans api/checkout.js (LOCAIR10, LOCA10)
--   - les pourcentages fixes de api/_lib/promo.js (parrainage 30%, relance
--     client dormant 20%) — ce mécanisme "prénom + %" reste un filet de
--     repli, il n'est pas supprimé.
--
-- Ne couvre PAS le programme "Offre Privilège" (rachat par le client de son
-- climatiseur après beaucoup de locations, table offres_privilege) : c'est
-- un mécanisme différent (vente d'un appareil, pas une remise marketing).
-- ================================================================

create table promotions (
  id                       bigint generated always as identity primary key,
  nom                      text not null,
  categorie                text not null default 'autre'
                             check (categorie in ('bienvenue','parrainage','fidelite','dormant','saisonnier','flash','partenaire','cadeau','groupe','autre')),
  -- null = remise automatique appliquée sans code (ex. réduction saisonnière
  -- visible directement sur le site) ; sinon le client doit saisir ce code.
  code                     text,
  type_remise              text not null check (type_remise in ('pourcentage','montant_fixe')),
  -- Pourcentage (0-100) ou montant en euros selon type_remise.
  valeur                   numeric not null check (valeur > 0),
  date_debut               date,
  date_fin                 date,
  duree_min_jours          integer,
  duree_max_jours          integer,
  premiere_resa_only       boolean not null default false,
  max_utilisations         integer,  -- null = illimité
  max_utilisations_client  integer,  -- null = illimité
  villes_ids               bigint[], -- null/vide = toutes les villes
  actif                    boolean not null default true,
  nb_utilisations          integer not null default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint promotions_valeur_pourcentage_check
    check (type_remise <> 'pourcentage' or valeur <= 100),
  constraint promotions_duree_check
    check (duree_min_jours is null or duree_max_jours is null or duree_min_jours <= duree_max_jours),
  constraint promotions_dates_check
    check (date_debut is null or date_fin is null or date_debut <= date_fin)
);
-- Un même code ne doit pointer que vers une seule offre active à la fois
-- (insensible à la casse — le client peut le taper en minuscules).
create unique index promotions_code_unique on promotions (upper(code)) where code is not null;
create index promotions_actif_idx on promotions (actif);

-- Historique des utilisations réelles — sert à faire respecter
-- max_utilisations_client (une remise "1 fois par client") et donne à Aly un
-- vrai suivi de ce que chaque offre a rapporté/coûté.
create table promotions_utilisations (
  id                    bigint generated always as identity primary key,
  promotion_id          bigint not null references promotions(id) on delete cascade,
  reservation_id        bigint references reservations(id) on delete set null,
  client_email          text,
  montant_remise_cents  integer not null default 0,
  created_at            timestamptz not null default now()
);
create index promotions_utilisations_promo_idx on promotions_utilisations (promotion_id);
create index promotions_utilisations_email_idx on promotions_utilisations (lower(client_email));

-- Incrément atomique du compteur d'utilisations — évite une lecture/écriture
-- séparée qui perdrait un comptage en cas de deux utilisations simultanées
-- du même code (même principe que available_units/assign_appareils).
create or replace function increment_promotion_usage(p_promotion_id bigint)
returns void
language sql
as $$
  update promotions set nb_utilisations = nb_utilisations + 1, updated_at = now() where id = p_promotion_id;
$$;
