-- Permet à une réservation de concerner une entreprise (raison sociale + SIRET),
-- pas seulement un particulier. Idempotent — sans risque à rejouer, y compris
-- si migration_2026-07-10d.sql (qui ajoute déjà type_client/siret en text nu,
-- sans contrainte) a été appliquée avant celle-ci.

alter table reservations add column if not exists type_client text;

-- Normalise toute valeur existante (y compris les libellés bruts du site
-- "Particulier"/"Professionnel", ou NULL) vers les 2 valeurs canoniques,
-- avant d'ajouter la contrainte — sans quoi la contrainte échouerait si des
-- lignes existantes contiennent autre chose.
update reservations set type_client = 'entreprise'
  where type_client is not null and type_client ilike '%pro%' and type_client <> 'entreprise';
update reservations set type_client = 'particulier'
  where type_client is null or type_client not in ('particulier', 'entreprise');

alter table reservations alter column type_client set not null;
alter table reservations alter column type_client set default 'particulier';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservations_type_client_check'
  ) then
    alter table reservations
      add constraint reservations_type_client_check check (type_client in ('particulier','entreprise'));
  end if;
end $$;

alter table reservations add column if not exists raison_sociale text;
alter table reservations add column if not exists siret text;
