-- Loc'Air — schéma Supabase (Postgres)
-- À exécuter une fois dans l'éditeur SQL du projet Supabase.
-- Accès uniquement via la clé service-role, depuis les fonctions Vercel (jamais côté navigateur).

-- Anti-bruteforce sur les écrans de connexion (admin, transporteur). Une ligne
-- par tentative échouée, par IP ; voir api/_lib/ratelimit.js.
create table login_attempts (
  id         bigint generated always as identity primary key,
  key        text not null,
  created_at timestamptz not null default now()
);
create index login_attempts_key_idx on login_attempts (key, created_at);

create table cities (
  id            bigint generated always as identity primary key,
  slug          text not null unique,
  name          text not null,
  dep           text,
  postal        text,
  flotte_totale integer not null default 0 check (flotte_totale >= 0),
  actif         boolean not null default true,
  created_at    timestamptz not null default now()
);

create table transporteurs (
  id                       bigint generated always as identity primary key,
  city_id                  bigint not null references cities(id),
  nom                      text not null,
  telephone                text,
  email                    text, -- utilisé uniquement pour "code oublié"
  -- Code personnel (4-6 chiffres) : identifie ET authentifie ce transporteur,
  -- pour qu'un livreur ne puisse jamais agir avec l'identifiant d'un collègue.
  pin                      text not null unique,
  actif                    boolean not null default true,
  -- Rémunération par mission (définie par le propriétaire)
  taux_livraison_cents     integer not null default 0 check (taux_livraison_cents >= 0),
  taux_recuperation_cents  integer not null default 0 check (taux_recuperation_cents >= 0),
  -- Dernière position connue, envoyée par son téléphone pendant une mission
  -- en cours (voir api/transporteur-position.js). Pas d'historique conservé.
  position_lat             double precision,
  position_lng             double precision,
  position_at              timestamptz,
  created_at               timestamptz not null default now()
);
create index transporteurs_city_idx on transporteurs (city_id, actif);
create index transporteurs_pin_idx on transporteurs (pin) where actif;

create table reservations (
  id                       bigint generated always as identity primary key,
  city_id                  bigint not null references cities(id),
  ref                      text not null,
  stripe_payment_intent_id text unique,
  stripe_customer_id       text,
  prenom                   text,
  nom                      text,
  email                    text,
  tel                      text,
  adresse                  text,
  etage                    text,
  ascenseur                text,
  fenetre                  text,
  installation             text,
  date_debut               date not null,
  date_fin                 date not null,
  quantite                 integer not null default 1 check (quantite > 0),
  prix_total_cents         integer not null default 0,
  statut                   text not null default 'en_attente'
                             check (statut in ('en_attente','confirmee','annulee','terminee')),
  source                   text,
  created_at               timestamptz not null default now(),
  constraint reservations_dates_check check (date_fin > date_debut)
);
-- Seules les réservations actives/en attente comptent pour la disponibilité
create index reservations_avail_idx on reservations (city_id, date_debut, date_fin)
  where statut in ('en_attente','confirmee');
create index reservations_stripe_pi_idx on reservations (stripe_payment_intent_id);

-- Une ligne = une mission terrain (livraison ou récupération).
-- Cycle de vie : a_faire -> acceptee -> arrivee -> fait | probleme
--                a_faire -> refusee (transporteur indisponible, à réassigner)
create table livraisons (
  id                     bigint generated always as identity primary key,
  reservation_id         bigint not null references reservations(id) on delete cascade,
  type                   text not null check (type in ('livraison','recuperation')),
  transporteur_id        bigint references transporteurs(id),
  date_prevue            date not null,
  creneau                text,
  statut                 text not null default 'a_faire'
                           check (statut in ('a_faire','acceptee','refusee','arrivee','fait','probleme','annule')),
  -- Preuves terrain (chemins dans le bucket de stockage 'missions', jamais publics)
  photo_depart_path      text,   -- appareil au départ dépôt (livraison)
  video_installation_path text,  -- appareil en marche chez le client (livraison)
  photo_retour_path      text,   -- appareil récupéré chez le client (récupération)
  probleme_type          text check (probleme_type in ('client_injoignable','appareil_en_panne','retard','autre')),
  probleme_description   text,
  notes                  text,
  -- Rémunération du transporteur pour cette mission (figée au moment du "fait"
  -- pour ne pas bouger rétroactivement si le taux change ensuite)
  montant_du_cents       integer not null default 0,
  paye                   boolean not null default false,
  accepted_at            timestamptz,
  arrivee_at             timestamptz,
  fait_at                timestamptz,
  probleme_at            timestamptz,
  created_at             timestamptz not null default now()
);
create index livraisons_date_idx on livraisons (date_prevue, statut);
create index livraisons_transporteur_idx on livraisons (transporteur_id, statut);

-- Bucket privé pour les photos/vidéos de mission — accès uniquement via URL signée
-- générée côté serveur (clé service-role). Aucune policy publique nécessaire.
insert into storage.buckets (id, name, public) values ('missions', 'missions', false);

-- Demandes de virement transporteur. Le montant réel et le passage à 'verse'
-- sont toujours déclenchés par le propriétaire (voir api/admin-virements.js) —
-- aucun virement bancaire n'est automatisé.
create table virements (
  id             bigint generated always as identity primary key,
  transporteur_id bigint not null references transporteurs(id),
  montant_cents  integer not null default 0,
  statut         text not null default 'demande' check (statut in ('demande','verse')),
  created_at     timestamptz not null default now(),
  verse_at       timestamptz
);
create index virements_transporteur_idx on virements (transporteur_id, statut);

create table incidents (
  id                    bigint generated always as identity primary key,
  reservation_id        bigint references reservations(id) on delete set null,
  type                  text not null check (type in ('retard','materiel','autre')),
  description           text,
  montant_facture_cents integer not null default 0,
  statut                text not null default 'ouvert' check (statut in ('ouvert','facture','resolu')),
  created_at            timestamptz not null default now()
);
create index incidents_reservation_idx on incidents (reservation_id);

-- Disponibilité = flotte totale − réservations actives qui chevauchent la période.
-- Une réservation 'en_attente' de plus de 30 min ne compte plus (paiement abandonné).
create or replace function available_units(p_city_id bigint, p_date_debut date, p_date_fin date)
returns integer
language sql
stable
as $$
  select c.flotte_totale - coalesce(sum(r.quantite), 0)
  from cities c
  left join reservations r
    on r.city_id = c.id
    and r.date_debut < p_date_fin
    and r.date_fin   > p_date_debut
    and (
      r.statut = 'confirmee'
      or (r.statut = 'en_attente' and r.created_at > now() - interval '30 minutes')
    )
  where c.id = p_city_id
  group by c.flotte_totale;
$$;

-- Seed pour Nice — ajuster flotte_totale au vrai parc de climatiseurs avant mise en prod
insert into cities (slug, name, dep, postal, flotte_totale) values ('nice', 'Nice', '06', '06300', 3);
