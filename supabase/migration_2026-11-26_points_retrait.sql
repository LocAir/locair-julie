-- Points de retrait créés ou modifiés depuis l'admin (26/11/2026).
-- Une ligne = un point. `data` reprend les champs de api/_lib/pointsRetrait.js
-- (nom, ville, adresse, lat, lng, horaires, ouverture, fermes, stock, tel,
-- partenaire_code, exemple…). Même id qu'un point du code = le remplace.
-- actif = false : point retiré (seulement pour un point créé ici).
create table if not exists points_retrait (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  actif boolean not null default true,
  cree_par text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table points_retrait enable row level security;
