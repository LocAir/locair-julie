-- Permet à une réservation de concerner une entreprise (raison sociale + SIRET),
-- pas seulement un particulier. Idempotent — sans risque à rejouer.

alter table reservations
  add column if not exists type_client text not null default 'particulier';

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
