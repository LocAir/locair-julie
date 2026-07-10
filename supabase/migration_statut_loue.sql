-- ─────────────────────────────────────────────────────────────────────────────
-- Migration : statut "loué" pour un appareil (location hors système)
-- À exécuter dans Supabase → SQL Editor (une seule fois)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE appareils DROP CONSTRAINT IF EXISTS appareils_statut_check;
ALTER TABLE appareils ADD CONSTRAINT appareils_statut_check
  CHECK (statut IN ('disponible', 'panne', 'maintenance', 'loue'));

-- Exclut les appareils marqués "loué" du calcul de disponibilité, au même
-- titre que panne/maintenance (sans quoi ils resteraient proposés pour de
-- nouvelles réservations malgré le marquage manuel).
CREATE OR REPLACE FUNCTION available_units(p_city_id bigint, p_date_debut date, p_date_fin date)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  select
    (select count(*)::int from appareils a
       where a.city_id = p_city_id and a.statut not in ('panne', 'maintenance', 'loue'))
    - coalesce((
        select sum(r.quantite) from reservations r
        where r.city_id = p_city_id and r.statut = 'en_attente'
          and r.created_at > now() - interval '30 minutes'
          and r.date_debut < p_date_fin and r.date_fin > p_date_debut
      ), 0)
    - coalesce((
        select count(distinct ra.appareil_id)
        from reservation_appareils ra
        join reservations r on r.id = ra.reservation_id
        where r.city_id = p_city_id and r.statut = 'confirmee'
          and r.date_debut < p_date_fin and r.date_fin > p_date_debut
      ), 0);
$$;

CREATE OR REPLACE FUNCTION assign_appareils(p_reservation_id bigint, p_city_id bigint, p_quantite integer, p_date_debut date, p_date_fin date)
RETURNS setof appareils
LANGUAGE plpgsql
AS $$
declare
  v_ids bigint[];
begin
  select array_agg(id) into v_ids from (
    select a.id from appareils a
    where a.city_id = p_city_id and a.statut not in ('panne', 'maintenance', 'loue')
      and not exists (
        select 1 from reservation_appareils ra
        join reservations r on r.id = ra.reservation_id
        where ra.appareil_id = a.id and r.statut = 'confirmee'
          and r.date_debut < p_date_fin and r.date_fin > p_date_debut
      )
    order by a.numero
    limit p_quantite
    for update of a skip locked
  ) sub;

  if v_ids is not null then
    insert into reservation_appareils (reservation_id, appareil_id)
      select p_reservation_id, unnest(v_ids)
      on conflict do nothing;
  end if;

  return query select * from appareils where id = any(v_ids);
end;
$$;
