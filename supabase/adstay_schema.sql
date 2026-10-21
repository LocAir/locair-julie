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
