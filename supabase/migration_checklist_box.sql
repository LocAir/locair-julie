-- Checklist matériel "à récupérer au box" — une validation par transporteur
-- et par jour. L'existence d'une ligne = checklist prise en charge ; la
-- supprimer revient à annuler la prise en charge (bouton "Retour").
create table if not exists checklist_box (
  id              bigint generated always as identity primary key,
  transporteur_id bigint not null references transporteurs(id) on delete cascade,
  date            date not null,
  validated_at    timestamptz not null default now(),
  unique (transporteur_id, date)
);
create index if not exists checklist_box_transporteur_idx on checklist_box (transporteur_id, date);
