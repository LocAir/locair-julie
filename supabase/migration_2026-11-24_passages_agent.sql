-- Passages de l'agent Loc'Air dans les points de retrait (24/11/2026).
-- Convention : un passage tous les 10 jours (entretien des climatiseurs).
-- Une ligne par passage, posée depuis l'admin (Points de retrait →
-- « Passage fait »). L'admin affiche le dernier passage de chaque point,
-- en rouge au-delà de 10 jours.
create table if not exists passages_agent (
  id         bigint generated always as identity primary key,
  point_id   text not null,
  fait_le    date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists passages_agent_point_idx on passages_agent (point_id, fait_le desc);
alter table passages_agent enable row level security;
