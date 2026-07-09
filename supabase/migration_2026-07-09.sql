-- Loc'Air — migration cumulative, sûre à exécuter plusieurs fois et quel que
-- soit l'état actuel de la base (tout est protégé par "if not exists" /
-- "if exists"). Colle ce fichier en entier dans l'éditeur SQL Supabase et
-- exécute-le en une fois.
--
-- Ne touche PAS aux données déjà en place (aucun insert de seed ici — le parc
-- d'appareils et la ville sont déjà en base).

-- ── Stock numéroté par appareil ───────────────────────────────────────────────
create table if not exists appareils (
  id         bigint generated always as identity primary key,
  city_id    bigint not null references cities(id),
  numero     integer not null,
  statut     text not null default 'disponible' check (statut in ('disponible','panne','maintenance')),
  reference  text,
  notes      text,
  created_at timestamptz not null default now(),
  unique (city_id, numero)
);
create index if not exists appareils_city_statut_idx on appareils (city_id, statut);

create table if not exists reservation_appareils (
  id             bigint generated always as identity primary key,
  reservation_id bigint not null references reservations(id) on delete cascade,
  appareil_id    bigint not null references appareils(id),
  created_at     timestamptz not null default now(),
  unique (reservation_id, appareil_id)
);
create index if not exists reservation_appareils_resa_idx on reservation_appareils (reservation_id);
create index if not exists reservation_appareils_app_idx  on reservation_appareils (appareil_id);

-- ── Position live du transporteur ─────────────────────────────────────────────
alter table transporteurs add column if not exists position_lat double precision;
alter table transporteurs add column if not exists position_lng double precision;
alter table transporteurs add column if not exists position_at timestamptz;

-- ── Incidents rattachés à une ville ───────────────────────────────────────────
alter table incidents add column if not exists city_id bigint references cities(id);
create index if not exists incidents_city_idx on incidents (city_id, statut);

-- ── Étapes/preuves du parcours livreur ────────────────────────────────────────
alter table livraisons add column if not exists client_notifie_at timestamptz;
alter table livraisons add column if not exists photo_absence_path text;
alter table livraisons add column if not exists vidange_confirmee boolean not null default false;
alter table livraisons add column if not exists vidange_at timestamptz;

-- "Client injoignable" renommé en "client_absent" (photo de passage + SMS
-- automatique) — recrée la contrainte quel que soit son nom actuel.
alter table livraisons drop constraint if exists livraisons_probleme_type_check;
alter table livraisons add constraint livraisons_probleme_type_check
  check (probleme_type in ('client_absent','appareil_en_panne','retard','autre'));

-- ── Créneau choisi par le client, jusqu'à la mission ──────────────────────────
alter table reservations add column if not exists creneau text;

-- ── Téléphone secondaire (secours) sur une réservation ────────────────────────
alter table reservations add column if not exists tel_secondaire text;

-- ── Masquer une réservation de la liste admin (ex. doublon) sans l'annuler ────
alter table reservations add column if not exists masquee boolean not null default false;

-- ── Fiche client persistante ───────────────────────────────────────────────────
create table if not exists clients (
  id                bigint generated always as identity primary key,
  city_id           bigint not null references cities(id),
  prenom            text,
  nom               text,
  tel               text,
  tel_normalise     text,
  email             text,
  acces_difficile   text,
  created_at        timestamptz not null default now()
);
create index if not exists clients_city_tel_idx on clients (city_id, tel_normalise);
alter table reservations add column if not exists client_id bigint references clients(id);

-- ── Notifications push (web-push) ─────────────────────────────────────────────
create table if not exists push_subscriptions (
  id              bigint generated always as identity primary key,
  transporteur_id bigint not null references transporteurs(id) on delete cascade,
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  created_at      timestamptz not null default now()
);
create index if not exists push_subscriptions_transporteur_idx on push_subscriptions (transporteur_id);

-- ── Authentification biométrique (WebAuthn) ───────────────────────────────────
create table if not exists webauthn_credentials (
  id              bigint generated always as identity primary key,
  transporteur_id bigint not null references transporteurs(id) on delete cascade,
  credential_id   text not null unique,
  public_key      text not null,
  counter         bigint not null default 0,
  device_type     text,
  backed_up       boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists webauthn_credentials_transporteur_idx on webauthn_credentials (transporteur_id);

create table if not exists webauthn_challenges (
  id         bigint generated always as identity primary key,
  challenge  text not null unique,
  created_at timestamptz not null default now()
);

-- ── Bucket de stockage des preuves (photos/vidéos de mission) ────────────────
insert into storage.buckets (id, name, public)
  values ('missions', 'missions', false)
  on conflict (id) do nothing;

-- ── Fonctions de disponibilité / assignation d'appareils ──────────────────────
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

-- Fin de la migration.
