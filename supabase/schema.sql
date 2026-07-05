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
  actif         boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Un appareil physique = une ligne, numérotée (étiquette à coller dessus).
-- 'panne'/'maintenance' l'excluent définitivement du calcul de disponibilité
-- jusqu'à ce qu'un admin le repasse en 'disponible'. Il n'y a pas de statut
-- "loué" stocké ici : le fait qu'un appareil soit actuellement chez un client
-- se déduit de reservation_appareils (voir plus bas), pour ne jamais avoir à
-- le remettre à jour manuellement au retour du client.
create table appareils (
  id         bigint generated always as identity primary key,
  city_id    bigint not null references cities(id),
  numero     integer not null,
  statut     text not null default 'disponible' check (statut in ('disponible','panne','maintenance')),
  notes      text,
  created_at timestamptz not null default now(),
  unique (city_id, numero)
);
create index appareils_city_statut_idx on appareils (city_id, statut);

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

-- Quels appareils numérotés sont retenus pour quelle réservation. Rempli
-- automatiquement à la confirmation du paiement (voir api/_lib/reservations.js,
-- assign_appareils ci-dessous) — jamais à la création (une réservation encore
-- 'en_attente' peut être abandonnée, on ne bloque pas un appareil précis pour ça).
create table reservation_appareils (
  id             bigint generated always as identity primary key,
  reservation_id bigint not null references reservations(id) on delete cascade,
  appareil_id    bigint not null references appareils(id),
  created_at     timestamptz not null default now(),
  unique (reservation_id, appareil_id)
);
create index reservation_appareils_resa_idx on reservation_appareils (reservation_id);
create index reservation_appareils_app_idx  on reservation_appareils (appareil_id);

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

-- Disponibilité = appareils actifs (hors panne/maintenance) moins :
--  - les réservations 'en_attente' récentes (< 30 min, paiement en cours, pas
--    encore d'appareil précis assigné) qui chevauchent la période demandée ;
--  - les appareils déjà retenus par une réservation confirmée qui chevauche
--    la période demandée.
-- Compte par quantité (pas par appareil précis) côté 'en_attente' car on ne
-- veut pas réserver un numéro précis pour un panier qui peut être abandonné.
create or replace function available_units(p_city_id bigint, p_date_debut date, p_date_fin date)
returns integer
language sql
stable
as $$
  select
    (select count(*)::int from appareils a
       where a.city_id = p_city_id and a.statut not in ('panne', 'maintenance'))
    - coalesce((
        select sum(r.quantite) from reservations r
        where r.city_id = p_city_id and r.statut = 'en_attente'
          and r.created_at > now() - interval '30 minutes'
          and r.date_debut < p_date_fin and r.date_fin > p_date_debut
      ), 0)
    - coalesce((
        select count(distinct ra.appareil_id)
        from reservation_appareils ra
        join reservations r on r.id = ra.reservation_id
        where r.city_id = p_city_id and r.statut = 'confirmee'
          and r.date_debut < p_date_fin and r.date_fin > p_date_debut
      ), 0);
$$;

-- Assigne p_quantite appareils (les plus petits numéros libres d'abord) à une
-- réservation confirmée : exclut panne/maintenance et les appareils déjà
-- retenus par une AUTRE réservation confirmée qui chevauche la même période.
-- "for update skip locked" évite qu'un webhook Stripe redélivré en parallèle
-- assigne deux fois le même appareil.
create or replace function assign_appareils(p_reservation_id bigint, p_city_id bigint, p_quantite integer, p_date_debut date, p_date_fin date)
returns setof appareils
language plpgsql
as $$
declare
  v_ids bigint[];
begin
  select array_agg(id) into v_ids from (
    select a.id from appareils a
    where a.city_id = p_city_id and a.statut not in ('panne', 'maintenance')
      and not exists (
        select 1 from reservation_appareils ra
        join reservations r on r.id = ra.reservation_id
        where ra.appareil_id = a.id and r.statut = 'confirmee'
          and r.date_debut < p_date_fin and r.date_fin > p_date_debut
      )
    order by a.numero
    limit p_quantite
    for update of a skip locked
  ) sub;

  if v_ids is not null then
    insert into reservation_appareils (reservation_id, appareil_id)
      select p_reservation_id, unnest(v_ids)
      on conflict do nothing;
  end if;

  return query select * from appareils where id = any(v_ids);
end;
$$;

-- Seed pour Nice — ajuster le nombre d'appareils insérés ci-dessous au vrai parc
insert into cities (slug, name, dep, postal) values ('nice', 'Nice', '06', '06300');
insert into appareils (city_id, numero)
  select id, n from cities, generate_series(1, 3) as n where slug = 'nice';
