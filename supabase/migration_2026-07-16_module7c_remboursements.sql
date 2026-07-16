-- ================================================================
-- MODULE 7 (suite) — Remboursement direct depuis l'admin (Partie 21).
-- Historique dédié plutôt que noyé dans "incidents" (comme c'était le cas
-- jusqu'ici pour un remboursement fait à la main dans Stripe) : montant,
-- raison, et qui a validé — exactement ce que le module demande de
-- conserver. reservations.statut passe à 'remboursee' comme avant, via le
-- webhook Stripe existant (charge.refunded) quand Stripe confirme le
-- remboursement — cette migration n'y touche pas.
-- ================================================================

create table remboursements (
  id               bigint generated always as identity primary key,
  reservation_id   bigint not null references reservations(id) on delete cascade,
  montant_cents    integer not null check (montant_cents > 0),
  raison           text not null,
  stripe_refund_id text,
  demande_par      text, -- nom (ou rôle) du compte admin ayant déclenché le remboursement
  created_at       timestamptz not null default now()
);
create index remboursements_resa_idx on remboursements (reservation_id);
