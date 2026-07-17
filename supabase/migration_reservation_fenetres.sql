-- Répartition du nombre de climatiseurs par type de fenêtre pour une même
-- réservation (ex. 2 sur porte coulissante + 1 sur Vélux) — le champ
-- reservations.fenetre reste un résumé texte (affichage/compat), cette table
-- est la source de vérité pour le calcul des kits de calfeutrage par type
-- (voir kitPourFenetre, api/_lib/checklistBox.js). Absente pour les
-- réservations créées avant cette fonctionnalité ou via le formulaire admin
-- (repli sur reservations.fenetre appliqué à toute la quantité).
create table if not exists reservation_fenetres (
  id             bigint generated always as identity primary key,
  reservation_id bigint not null references reservations(id) on delete cascade,
  type           text not null,
  quantite       integer not null check (quantite > 0),
  created_at     timestamptz not null default now()
);
create index if not exists reservation_fenetres_resa_idx on reservation_fenetres (reservation_id);
