-- Espace partenaire (conciergeries et autres apporteurs d'affaires) : un
-- partenaire pose un lien d'affiliation (ex. locair.fr/?p=SONCODE) sur son
-- propre site, et touche une commission sur chaque réservation faite depuis
-- ce lien. Idempotent — sans risque à rejouer.

create table if not exists partenaires (
  id                  bigint generated always as identity primary key,
  nom                 text not null, -- nom de la conciergerie/entreprise
  contact_nom         text,          -- personne de contact, si différent de "nom"
  email               text,
  telephone           text,
  -- Code utilisé dans le lien d'affiliation (ex. ?p=CODE) — public, visible
  -- dans l'URL. Distinct du PIN (secret, sert uniquement à se connecter).
  code                text not null unique,
  pin                 text not null unique,
  taux_commission_pct integer not null default 10 check (taux_commission_pct >= 0 and taux_commission_pct <= 100),
  actif               boolean not null default true,
  created_at          timestamptz not null default now()
);
create index if not exists partenaires_code_idx on partenaires (code) where actif;
create index if not exists partenaires_pin_idx  on partenaires (pin)  where actif;

-- Quelle réservation vient d'un partenaire, et combien lui est dû. Le taux
-- est figé au moment de la réservation (partenaire_commission_cents), comme
-- livraisons.montant_du_cents pour les transporteurs — pour ne pas bouger
-- rétroactivement si le taux du partenaire change ensuite.
alter table reservations add column if not exists partenaire_id bigint references partenaires(id);
alter table reservations add column if not exists partenaire_commission_cents integer not null default 0;
alter table reservations add column if not exists partenaire_commission_payee boolean not null default false;
create index if not exists reservations_partenaire_idx on reservations (partenaire_id) where partenaire_id is not null;

-- Demandes de virement partenaire — même logique que la table `virements`
-- des transporteurs, mais séparée pour ne rien toucher à ce circuit déjà en
-- prod. Le montant réel et le passage à 'verse' sont toujours déclenchés par
-- le propriétaire (voir api/admin-partenaire-virements.js) — aucun virement
-- bancaire n'est automatisé.
create table if not exists partenaire_virements (
  id            bigint generated always as identity primary key,
  partenaire_id bigint not null references partenaires(id),
  montant_cents integer not null default 0,
  statut        text not null default 'demande' check (statut in ('demande','verse')),
  created_at    timestamptz not null default now(),
  verse_at      timestamptz
);
create index if not exists partenaire_virements_partenaire_idx on partenaire_virements (partenaire_id, statut);
