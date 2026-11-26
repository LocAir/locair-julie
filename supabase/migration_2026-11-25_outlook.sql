-- Boîte Outlook partenaires (25/11/2026) : les e-mails aux commerçants
-- partent de partenaires.locair@outlook.com. Une seule ligne (id = 1) :
-- le jeton longue durée donné par Microsoft quand le gérant relie la boîte
-- depuis l'admin (accueil → Envoi rapide → « Relier Outlook »).
create table if not exists outlook_connexion (
  id               int primary key default 1 check (id = 1),
  compte           text,
  refresh_token    text,
  connecte_at      timestamptz,
  dernier_envoi_at timestamptz,
  derniere_erreur  text
);
alter table outlook_connexion enable row level security;
