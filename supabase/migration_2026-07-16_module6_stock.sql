-- ================================================================
-- MODULE 6 — Gestion du stock / parc climatiseurs
-- Historique des mouvements + localisation matériel, validation
-- administrative de l'attribution d'un appareil (oversight, ne
-- bloque pas la confirmation automatique existante), checklist de
-- préparation avant livraison (réutilise checklist_items du Module 5),
-- et correction d'un oubli du Module 5 : un appareil "nettoyage" doit
-- être exclu de la disponibilité, comme panne/maintenance/loué.
-- ================================================================

-- --- Localisation actuelle de chaque climatiseur ---
alter table appareils add column localisation text not null default 'stock_principal'
  check (localisation in ('stock_principal','vehicule_transporteur','chez_client','maintenance','autre'));

-- --- Historique des mouvements — "aucun mouvement ne doit être invisible" ---
create table appareil_mouvements (
  id                    bigint generated always as identity primary key,
  appareil_id           bigint not null references appareils(id) on delete cascade,
  type_evenement        text not null check (type_evenement in (
                          'entree_parc','attribution_reservation','preparation_livraison','depart_entrepot',
                          'livraison_client','installation','recuperation','retour_stockage',
                          'passage_maintenance','remise_disponibilite','autre'
                        )),
  ancien_statut         text,
  nouveau_statut        text not null,
  ancienne_localisation text,
  nouvelle_localisation text not null,
  livraison_id          bigint references livraisons(id) on delete set null,
  reservation_id        bigint references reservations(id) on delete set null,
  utilisateur           text, -- nom du transporteur, "admin", ou "systeme" (automatique)
  commentaire           text,
  created_at            timestamptz not null default now()
);
create index appareil_mouvements_appareil_idx on appareil_mouvements (appareil_id, created_at desc);

-- --- Checklist de préparation avant livraison (Partie 7) ---
-- Réutilise la table checklist_items du Module 5 (administrable, même
-- écran admin) : un 3e "workflow" en plus de installation/recuperation.
alter table checklist_items drop constraint checklist_items_workflow_check;
alter table checklist_items add constraint checklist_items_workflow_check
  check (workflow in ('installation','recuperation','preparation'));

insert into checklist_items (workflow, libelle, ordre) values
  ('preparation', 'Climatiseur correspondant sélectionné', 1),
  ('preparation', 'État contrôlé', 2),
  ('preparation', 'Télécommande présente', 3),
  ('preparation', 'Gaine présente', 4),
  ('preparation', 'Kit de calfeutrage présent', 5),
  ('preparation', 'Notice présente', 6),
  ('preparation', 'Appareil propre', 7);

-- --- Validation administrative de l'attribution d'un appareil (Partie 6) ---
-- Oversight uniquement : ne bloque ni la confirmation de réservation, ni la
-- création des missions transporteur (déjà automatiques et fiables depuis le
-- Module 1 — available_units/assign_appareils empêchent déjà tout
-- chevauchement). Sert à donner à l'administration un droit de regard
-- explicite sur "quel appareil précis a été retenu pour quelle réservation".
alter table reservation_appareils add column valide boolean not null default false;
alter table reservation_appareils add column valide_at timestamptz;
-- Les attributions déjà en place avant ce module sont considérées validées
-- de fait (pas de vérification rétroactive à faire).
update reservation_appareils set valide = true, valide_at = created_at;
alter table reservation_appareils alter column valide set default false;

-- --- Correctif Module 5 : "nettoyage" doit être exclu de la disponibilité ---
create or replace function available_units(p_city_id bigint, p_date_debut date, p_date_fin date)
returns integer
language sql
stable
as $$
  select
    (select count(*)::int from appareils a
       where a.city_id = p_city_id and a.statut not in ('panne', 'maintenance', 'loue', 'nettoyage'))
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

create or replace function assign_appareils(p_reservation_id bigint, p_city_id bigint, p_quantite integer, p_date_debut date, p_date_fin date)
returns setof appareils
language plpgsql
as $$
declare
  v_ids bigint[];
begin
  select array_agg(id) into v_ids from (
    select a.id from appareils a
    where a.city_id = p_city_id and a.statut not in ('panne', 'maintenance', 'loue', 'nettoyage')
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
