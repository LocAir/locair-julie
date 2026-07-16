-- ================================================================
-- OFFRE PRIVILÈGE — Step 1 : détection d'éligibilité seulement.
-- Un climatiseur très loué, actuellement chez un client, peut lui être
-- proposé à l'achat plutôt que récupéré. Cette étape se contente de
-- repérer les climatiseurs concernés et de prévenir l'admin — aucun prix,
-- aucune offre visible côté client, aucun paiement pour l'instant (viendra
-- dans une 2e étape, une fois cette détection en place).
-- ================================================================

create table offres_privilege (
  id             bigint generated always as identity primary key,
  appareil_id    bigint not null references appareils(id) on delete cascade,
  reservation_id bigint references reservations(id) on delete set null,
  nb_locations   integer not null,
  statut         text not null default 'eligible'
                   check (statut in ('eligible', 'proposee', 'acceptee', 'refusee', 'annulee')),
  prix_vente_cents        integer,
  stripe_payment_intent_id text,
  created_at     timestamptz not null default now(),
  decidee_at     timestamptz
);
create index offres_privilege_appareil_idx on offres_privilege (appareil_id);
