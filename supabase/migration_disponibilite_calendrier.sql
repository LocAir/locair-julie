-- Migration : calendrier de disponibilité en temps réel (J+1 après récupération)
-- À coller dans Supabase → SQL Editor et exécuter avant déploiement du code.
--
-- Problème résolu :
--   L'ancienne available_units utilisait `date_fin` comme borne de fin d'occupation.
--   Or l'appareil est encore chez le client le jour date_fin (dernier jour de
--   location), et la récupération a lieu J+1. La nouvelle version utilise la date
--   de la mission de récupération réelle (livraisons.date_prevue, type 'recuperation')
--   et bloque jusqu'au lendemain de cette récupération.
--
--   Effet concret :
--     - Réservation se termine le 10 août → récupération le 11 → disponible le 12
--     - Prolongation confirmée jusqu'au 15 → récupération le 16 → disponible le 17
--     - Si aucune mission récup active → fallback : date_fin + 1 (récup), dispo le + 2

-- 1. available_units — utilisé par checkout.js et mode-complet.js
create or replace function available_units(p_city_id bigint, p_date_debut date, p_date_fin date)
returns integer
language sql
stable
as $$
  select
    -- Appareils opérationnels dans la ville
    (select count(*)::int from appareils a
       where a.city_id = p_city_id
         and a.statut not in ('panne', 'maintenance', 'loue', 'nettoyage', 'vendu'))
    -- Réservations en attente récentes (filet anti-double-booking, max 30 min)
    - coalesce((
        select sum(r.quantite) from reservations r
        where r.city_id = p_city_id
          and r.statut = 'en_attente'
          and r.created_at > now() - interval '30 minutes'
          and r.date_debut < p_date_fin
          and r.date_fin > p_date_debut
      ), 0)
    -- Appareils confirmés : bloqués jusqu'au lendemain de leur récupération réelle
    - coalesce((
        select count(distinct ra.appareil_id)
        from reservation_appareils ra
        join reservations r on r.id = ra.reservation_id
        where r.city_id = p_city_id
          and r.statut = 'confirmee'
          and r.date_debut < p_date_fin
          -- Date effective de fin d'occupation = jour de récupération (mission active)
          -- ou date_fin + 1 par défaut — l'appareil est libre à compter du lendemain.
          and (
            coalesce(
              (select max(l.date_prevue)::date
               from livraisons l
               where l.reservation_id = ra.reservation_id
                 and l.type = 'recuperation'
                 and l.statut not in ('annule', 'refusee')
              ),
              (r.date_fin + interval '1 day')::date
            ) + interval '1 day'
          )::date > p_date_debut
      ), 0);
$$;

-- 2. assign_appareils — même logique pour l'assignation physique des appareils
create or replace function assign_appareils(
  p_reservation_id bigint,
  p_city_id        bigint,
  p_quantite       integer,
  p_date_debut     date,
  p_date_fin       date
)
returns setof appareils
language plpgsql
as $$
declare
  v_ids bigint[];
begin
  select array_agg(id) into v_ids from (
    select a.id from appareils a
    where a.city_id = p_city_id
      and a.statut not in ('panne', 'maintenance', 'loue', 'nettoyage', 'vendu')
      and not exists (
        select 1
        from reservation_appareils ra
        join reservations r on r.id = ra.reservation_id
        where ra.appareil_id = a.id
          and r.statut = 'confirmee'
          and r.date_debut < p_date_fin
          and (
            coalesce(
              (select max(l.date_prevue)::date
               from livraisons l
               where l.reservation_id = ra.reservation_id
                 and l.type = 'recuperation'
                 and l.statut not in ('annule', 'refusee')
              ),
              (r.date_fin + interval '1 day')::date
            ) + interval '1 day'
          )::date > p_date_debut
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
