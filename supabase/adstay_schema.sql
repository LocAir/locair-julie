-- AdStay : base de données (projet Supabase SÉPARÉ de Loc'Air).
-- À coller en entier dans Supabase → SQL Editor → Run, une seule fois.
-- Peut être relancé sans casse (create … if not exists / on conflict).

-- ─── Profils : un par compte (Google ou e-mail) ──────────────────────────────
create table if not exists public.profils (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  role       text not null default 'commercant' check (role in ('commercant', 'admin')),
  created_at timestamptz not null default now()
);

-- Chaque nouveau compte reçoit automatiquement son profil « commerçant »
create or replace function public.adstay_nouveau_compte() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profils (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists adstay_nouveau_compte on auth.users;
create trigger adstay_nouveau_compte after insert on auth.users
  for each row execute function public.adstay_nouveau_compte();

create or replace function public.est_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profils where id = auth.uid() and role = 'admin');
$$;

-- ─── Formules publicitaires (prix modifiables depuis l'admin) ────────────────
create table if not exists public.formules (
  id         text primary key,
  nom        text not null,
  prix       numeric not null,
  rang       int  not null,           -- plus haut = plus haut dans la liste
  diaporama  int  not null default 0, -- passages par tour dans le diaporama de veille
  badge      text not null default '',
  pour       text not null default '',
  avantages  text[] not null default '{}'
);
insert into public.formules (id, nom, prix, rang, diaporama, badge, pour, avantages) values
  ('essentielle', 'Essentielle', 39, 1, 0, '', 'Pour un petit commerçant ou un restaurant',
   array['Présence dans une catégorie', 'Nom, photo, adresse et coordonnées', 'Accès à un réseau local de logements']),
  ('premium', 'Premium', 79, 2, 1, 'Recommandé', 'Pour les établissements qui veulent plus de visibilité',
   array['Mise en avant prioritaire', 'Offre spéciale pour les voyageurs', 'Bouton de réservation ou de contact', 'Présence dans le diaporama de veille']),
  ('exclusivite', 'Exclusivité', 149, 3, 2, 'Coup de cœur', 'Pour une catégorie ou une zone géographique',
   array['Visibilité renforcée, en tête de liste', 'Possibilité d’exclusivité par catégorie', 'Diaporama de veille ×2', 'Statistiques et bilan mensuel'])
on conflict (id) do nothing;

-- ─── Fiches des commerçants ──────────────────────────────────────────────────
-- statut : brouillon (pas fini) → en_attente (envoyé pour validation)
--          → publie (visible sur les tablettes) ; suspendu = retiré par l'admin
create table if not exists public.commercants (
  id                 uuid primary key default gen_random_uuid(),
  proprietaire       uuid references public.profils(id) on delete set null,
  nom                text not null,
  categorie          text not null,
  formule            text not null default 'essentielle' references public.formules(id),
  formule_souhaitee  text references public.formules(id),
  statut             text not null default 'brouillon'
                       check (statut in ('brouillon', 'en_attente', 'publie', 'suspendu')),
  accroche           text not null default '',
  description        text not null default '',
  adresse            text not null default '',
  tel                text not null default '',
  horaires           text not null default '',
  offre              text not null default '',
  lien               text not null default '',
  photo              text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Ajouts : anglais, position (distance à pied), horaires structurés (« ouvert maintenant »)
alter table public.commercants add column if not exists accroche_en    text not null default '';
alter table public.commercants add column if not exists description_en text not null default '';
alter table public.commercants add column if not exists offre_en       text not null default '';
alter table public.commercants add column if not exists lat            double precision;
alter table public.commercants add column if not exists lon            double precision;
alter table public.commercants add column if not exists creneaux       text not null default '';   -- ex. '12:00-14:30 19:00-22:30'
alter table public.commercants add column if not exists fermes         text[] not null default '{}'; -- ex. {lun,dim}
alter table public.formules    add column if not exists badge_en       text not null default '';
update public.formules set badge_en = 'Recommended' where id = 'premium' and badge_en = '';
update public.formules set badge_en = 'Our pick' where id = 'exclusivite' and badge_en = '';

-- Un commerçant ne peut ni se publier lui-même, ni changer sa formule payée,
-- ni donner sa fiche à quelqu'un d'autre. Seul un admin le peut.
create or replace function public.adstay_garde_commercant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if public.est_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.proprietaire := auth.uid();
    new.formule := 'essentielle';
    if new.statut not in ('brouillon', 'en_attente') then new.statut := 'brouillon'; end if;
  else
    new.proprietaire := old.proprietaire;
    new.formule := old.formule;
    if new.statut is distinct from old.statut
       and not (old.statut = 'brouillon' and new.statut = 'en_attente') then
      new.statut := old.statut;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists adstay_garde_commercant on public.commercants;
create trigger adstay_garde_commercant before insert or update on public.commercants
  for each row execute function public.adstay_garde_commercant();

-- ─── Droits d'accès (RLS) ────────────────────────────────────────────────────
alter table public.profils     enable row level security;
alter table public.formules    enable row level security;
alter table public.commercants enable row level security;

drop policy if exists "profil: soi ou admin" on public.profils;
create policy "profil: soi ou admin" on public.profils for select
  using (id = auth.uid() or public.est_admin());
drop policy if exists "profil: admin modifie" on public.profils;
create policy "profil: admin modifie" on public.profils for update
  using (public.est_admin()) with check (public.est_admin());

drop policy if exists "formules: lecture publique" on public.formules;
create policy "formules: lecture publique" on public.formules for select using (true);
drop policy if exists "formules: admin modifie" on public.formules;
create policy "formules: admin modifie" on public.formules for all
  using (public.est_admin()) with check (public.est_admin());

-- Tablettes (sans compte) : seulement les fiches publiées
drop policy if exists "commercants: publiés visibles" on public.commercants;
create policy "commercants: publiés visibles" on public.commercants for select
  using (statut = 'publie' or proprietaire = auth.uid() or public.est_admin());
drop policy if exists "commercants: créer sa fiche" on public.commercants;
create policy "commercants: créer sa fiche" on public.commercants for insert
  with check (auth.uid() is not null);
drop policy if exists "commercants: modifier sa fiche" on public.commercants;
create policy "commercants: modifier sa fiche" on public.commercants for update
  using (proprietaire = auth.uid() or public.est_admin());
drop policy if exists "commercants: admin supprime" on public.commercants;
create policy "commercants: admin supprime" on public.commercants for delete
  using (public.est_admin());

-- ─── Photos des fiches (stockage public, chacun dans son dossier) ───────────
insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
  on conflict (id) do nothing;
drop policy if exists "photos: envoyer dans son dossier" on storage.objects;
create policy "photos: envoyer dans son dossier" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "photos: remplacer dans son dossier" on storage.objects;
create policy "photos: remplacer dans son dossier" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ─── Statistiques : chaque commerçant suit les visites de sa fiche ──────────
-- vue       : un voyageur a ouvert la fiche sur une tablette
-- diaporama : la fiche est passée sur l'écran de veille
-- scan      : un voyageur a scanné le QR code (itinéraire, réservation)
create table if not exists public.evenements (
  id          bigint generated always as identity primary key,
  commercant  uuid not null references public.commercants(id) on delete cascade,
  type        text not null check (type in ('vue', 'diaporama', 'scan')),
  logement    text not null default '' check (length(logement) <= 80),
  created_at  timestamptz not null default now()
);
create index if not exists evenements_commercant_date on public.evenements (commercant, created_at);
alter table public.evenements enable row level security;

-- Les tablettes (sans compte) peuvent noter un événement, seulement sur une fiche publiée
drop policy if exists "evenements: tablettes notent" on public.evenements;
create policy "evenements: tablettes notent" on public.evenements for insert to anon, authenticated
  with check (exists (select 1 from public.commercants c where c.id = commercant and c.statut = 'publie'));
-- Lecture : le propriétaire de la fiche ou un admin
drop policy if exists "evenements: propriétaire lit" on public.evenements;
create policy "evenements: propriétaire lit" on public.evenements for select
  using (public.est_admin() or exists (select 1 from public.commercants c
         where c.id = commercant and c.proprietaire = auth.uid()));

-- Chiffres jour par jour pour une fiche (30 derniers jours par défaut)
create or replace function public.adstay_stats(p_commercant uuid, p_jours int default 30)
returns table (jour date, vues bigint, diaporama bigint, scans bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.est_admin() or exists (select 1 from public.commercants
          where id = p_commercant and proprietaire = auth.uid())) then
    raise exception 'acces refuse';
  end if;
  return query
    select d::date,
      count(e.*) filter (where e.type = 'vue'),
      count(e.*) filter (where e.type = 'diaporama'),
      count(e.*) filter (where e.type = 'scan')
    from generate_series(current_date - (least(greatest(p_jours, 1), 365) - 1), current_date, interval '1 day') d
    left join public.evenements e
      on e.commercant = p_commercant and e.created_at >= d and e.created_at < d + interval '1 day'
    group by d order by d;
end $$;

-- ─── Compteur de visites par fiche (tableau de l'espace partenaires) ────────
-- Totaux sur N jours pour chaque fiche : l'admin voit toutes les fiches,
-- un commerçant seulement les siennes.
create or replace function public.adstay_resume(p_jours int default 30)
returns table (commercant uuid, vues bigint, scans bigint, diaporama bigint, vues_aujourdhui bigint)
language sql stable security definer set search_path = public as $$
  select c.id,
    count(e.*) filter (where e.type = 'vue'),
    count(e.*) filter (where e.type = 'scan'),
    count(e.*) filter (where e.type = 'diaporama'),
    count(e.*) filter (where e.type = 'vue' and e.created_at >= current_date)
  from public.commercants c
  left join public.evenements e
    on e.commercant = c.id and e.created_at >= current_date - (least(greatest(p_jours, 1), 365) - 1)
  where public.est_admin() or c.proprietaire = auth.uid()
  group by c.id;
$$;

-- ─── Logements équipés d'une tablette (des centaines) ───────────────────────
-- Chaque logement a un code secret. La tablette est installée une seule fois en
-- ouvrant /adstay?t=CODE (QR affiché dans l'espace admin) ; ensuite elle s'en souvient.
-- Le code n'est jamais montré aux voyageurs ni aux commerçants (les statistiques
-- utilisent l'identifiant du logement, pas le code).
create table if not exists public.logements (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique default lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  nom             text not null,
  adresse         text not null default '',
  lat             double precision,
  lon             double precision,
  wifi_reseau     text not null default '',
  wifi_mdp        text not null default '',
  arrivee         text not null default '16:00',
  depart          text not null default '11:00',
  infos           text[] not null default '{}',
  infos_en        text[] not null default '{}',
  mot_hote        text not null default '',
  mot_hote_en     text not null default '',
  signature       text not null default '',
  sejour_prenoms  text not null default '',
  sejour_du       date,
  sejour_au       date,
  actif           boolean not null default true,
  vu_le           timestamptz,              -- dernier signal de la tablette (toutes les 10 min)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.logements enable row level security;
-- Seuls les admins voient et gèrent les logements (Wi-Fi, prénoms des voyageurs…)
drop policy if exists "logements: admin" on public.logements;
create policy "logements: admin" on public.logements for all
  using (public.est_admin()) with check (public.est_admin());

create or replace function public.adstay_logement_maj() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists adstay_logement_maj on public.logements;
create trigger adstay_logement_maj before update of nom, adresse, lat, lon, wifi_reseau, wifi_mdp, arrivee, depart,
  infos, infos_en, mot_hote, mot_hote_en, signature, sejour_prenoms, sejour_du, sejour_au, actif, code
  on public.logements for each row execute function public.adstay_logement_maj();

-- La tablette (sans compte) lit SON logement grâce au code, et signale qu'elle est allumée.
create or replace function public.adstay_tablette(p_code text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare r public.logements;
begin
  if p_code is null or length(p_code) < 8 then return null; end if;
  update public.logements set vu_le = now() where code = p_code and actif returning * into r;
  if r.id is null then return null; end if;
  return json_build_object('id', r.id, 'nom', r.nom, 'adresse', r.adresse, 'lat', r.lat, 'lon', r.lon,
    'wifi_reseau', r.wifi_reseau, 'wifi_mdp', r.wifi_mdp, 'arrivee', r.arrivee, 'depart', r.depart,
    'infos', r.infos, 'infos_en', r.infos_en, 'mot_hote', r.mot_hote, 'mot_hote_en', r.mot_hote_en,
    'signature', r.signature, 'sejour_prenoms', r.sejour_prenoms, 'sejour_du', r.sejour_du, 'sejour_au', r.sejour_au,
    'maj', r.updated_at);
end $$;
grant execute on function public.adstay_tablette(text) to anon, authenticated;
