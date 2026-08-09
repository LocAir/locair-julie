-- ================================================================
-- Corrige 2 bugs réels du calendrier de disponibilité (signalés par Aly le
-- 2026-08-09 : "j'ai des récupérations demain et donc des appareils
-- disponibles, et pourtant le calendrier affiche complet pour les jours
-- suivants").
--
-- 1) BUG PRINCIPAL — un appareil actuellement en location (statut='loue')
--    était exclu du total de la flotte pour LES 90 JOURS DU CALENDRIER
--    D'UN COUP, pas seulement pour les jours où il est vraiment occupé. Le
--    calcul par date (plus bas, via reservations/livraisons) gère déjà
--    correctement la fenêtre d'occupation réelle d'un appareil loué — le
--    ré-exclure via son statut courant le faisait disparaître du calcul
--    pour toujours, même après sa récupération le lendemain. Seuls les
--    statuts SANS date de retour connue (panne, maintenance, nettoyage en
--    attente, vendu) doivent rester exclus du total.
--
-- 2) Priorité à la vraie date de complétion d'une récupération (fait_at,
--    quand statut='fait') sur la date simplement prévue (date_prevue) — un
--    climatiseur récupéré aujourd'hui doit être disponible dès demain,
--    même si la récupération a eu lieu plus tôt ou plus tard que prévu.
--    Une tentative ratée ('probleme') n'est plus jamais retenue comme date
--    fiable — le climatiseur n'est objectivement pas revenu ce jour-là.
--
-- Remplace la mise à jour du 2026-08-07 (migration_disponibilite_calendrier.sql).
-- ================================================================

create or replace function available_units(p_city_id bigint, p_date_debut date, p_date_fin date)
returns integer
language sql
stable
as $$
  select
    (select count(*)::int from appareils a
       where a.city_id = p_city_id and a.statut not in ('panne', 'maintenance', 'nettoyage', 'vendu'))
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
          and r.date_debut < p_date_fin
          and (
            coalesce(
              (select max(l.fait_at at time zone 'Europe/Paris')::date
               from livraisons l
               where l.reservation_id = ra.reservation_id
                 and l.type = 'recuperation' and l.statut = 'fait'),
              (select max(l.date_prevue)::date
               from livraisons l
               where l.reservation_id = ra.reservation_id
                 and l.type = 'recuperation'
                 and l.statut not in ('annule', 'refusee', 'probleme')),
              (r.date_fin + interval '1 day')::date
            ) + interval '1 day'
          )::date > p_date_debut
      ), 0);
$$;

create or replace function assign_appareils(p_reservation_id bigint, p_city_id bigint, p_quantite integer, p_date_debut date, p_date_fin date)
returns setof appareils
language plpgsql
as $$
declare
  v_ids bigint[];
begin
  select array_agg(id) into v_ids from (
    select a.id from appareils a
    where a.city_id = p_city_id and a.statut not in ('panne', 'maintenance', 'nettoyage', 'vendu')
      and not exists (
        select 1 from reservation_appareils ra
        join reservations r on r.id = ra.reservation_id
        where ra.appareil_id = a.id and r.statut = 'confirmee'
          and r.date_debut < p_date_fin
          and (
            coalesce(
              (select max(l.fait_at at time zone 'Europe/Paris')::date
               from livraisons l
               where l.reservation_id = ra.reservation_id
                 and l.type = 'recuperation' and l.statut = 'fait'),
              (select max(l.date_prevue)::date
               from livraisons l
               where l.reservation_id = ra.reservation_id
                 and l.type = 'recuperation'
                 and l.statut not in ('annule', 'refusee', 'probleme')),
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
