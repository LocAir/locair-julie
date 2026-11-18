-- Click & Collect — à coller UNE FOIS dans Supabase → SQL Editor.
-- Le code est déjà en ligne avant cette migration : sans ces colonnes, il
-- se replie sur d'autres champs (instructions_acces, adresse) sans rien
-- perdre. Après la migration, tout passe par ces colonnes.

-- 1. Pièce d'identité du client (carte recto/verso ou passeport) : chemins
--    des fichiers dans le bucket privé "missions" (préfixe identites/),
--    jamais d'URL publique. Lus par l'admin via des liens signés d'1 h,
--    supprimés 30 jours après la fin de la location (cron-daily.js).
alter table reservations add column if not exists piece_identite_paths text[];

-- 2. Point de retrait choisi (id de api/_lib/pointsRetrait.js) : sert au
--    stock figé par point et au prix fort à 80 % d'occupation.
alter table reservations add column if not exists point_retrait_id text;
create index if not exists reservations_point_retrait_idx on reservations (point_retrait_id, date_debut, date_fin) where point_retrait_id is not null;

-- 3. Remise au client validée par le commerçant (scan du QR code depuis
--    son espace partenaire, api/partenaire-remise.js).
alter table reservations add column if not exists remis_at timestamptz;
alter table reservations add column if not exists remis_par_partenaire_id bigint references partenaires(id);
