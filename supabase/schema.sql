-- Loc'Air — schéma Supabase (Postgres)
-- À exécuter une fois dans l'éditeur SQL du projet Supabase.
-- Accès uniquement via la clé service-role, depuis les fonctions Vercel (jamais côté navigateur).

-- Anti-bruteforce sur les écrans de connexion (admin, transporteur). Une ligne
-- par tentative échouée, par IP ; voir api/_lib/ratelimit.js.
create table login_attempts (
  id         bigint generated always as identity primary key,
  key        text not null,
  created_at timestamptz not null default now()
);
create index login_attempts_key_idx on login_attempts (key, created_at);

create table cities (
  id            bigint generated always as identity primary key,
  slug          text not null unique,
  name          text not null,
  dep           text,
  postal        text,
  -- Une "ville" est en réalité une zone opérationnelle pouvant couvrir
  -- plusieurs communes (ex. Nice + Saint-Laurent-du-Var + Cagnes-sur-Mer) —
  -- postal_codes route chaque commande à la bonne zone à partir de l'adresse
  -- du client (voir api/_lib/city.js, resolveCityByAddress).
  postal_codes  text[] not null default '{}',
  sold_out      boolean not null default false, -- mode "complet" affiché sur le site (api/mode-complet.js)
  actif         boolean not null default true,
  created_at    timestamptz not null default now(),
  -- Barème payé au transporteur par mission, éditable dans l'admin (onglet
  -- Villes) — remplace l'ancien taux fixé par transporteur (voir
  -- api/_lib/bareme.js). null = valeur par défaut du barème.
  tarif_livraison_autonome_cents   integer,
  tarif_livraison_technicien_cents integer,
  tarif_recuperation_cents         integer,
  tarif_changement_cents           integer
);

-- Un appareil physique = une ligne, numérotée (étiquette à coller dessus).
-- 'panne'/'maintenance' l'excluent définitivement du calcul de disponibilité
-- jusqu'à ce qu'un admin le repasse en 'disponible'. Il n'y a pas de statut
-- "loué" stocké ici : le fait qu'un appareil soit actuellement chez un client
-- se déduit de reservation_appareils (voir plus bas), pour ne jamais avoir à
-- le remettre à jour manuellement au retour du client.
create table appareils (
  id         bigint generated always as identity primary key,
  city_id    bigint not null references cities(id),
  numero     integer not null,
  statut     text not null default 'disponible' check (statut in ('disponible','panne','maintenance','loue')),
  reference  text, -- référence produit du fabricant (ex. "RWAC10KA+"), saisie librement par l'admin
  notes      text,
  created_at timestamptz not null default now(),
  unique (city_id, numero)
);
create index appareils_city_statut_idx on appareils (city_id, statut);

create table transporteurs (
  id                       bigint generated always as identity primary key,
  city_id                  bigint not null references cities(id),
  nom                      text not null,
  telephone                text,
  email                    text, -- utilisé uniquement pour "code oublié"
  notes                    text, -- informations libres saisies par l'admin (fiche transporteur)
  -- Code personnel (4-6 chiffres) : identifie ET authentifie ce transporteur,
  -- pour qu'un livreur ne puisse jamais agir avec l'identifiant d'un collègue.
  pin                      text not null unique,
  actif                    boolean not null default true,
  en_pause                 boolean not null default false, -- mis en pause temporairement, ne reçoit plus de nouvelle mission
  -- Rémunération par mission (définie par le propriétaire)
  taux_livraison_cents     integer not null default 0 check (taux_livraison_cents >= 0),
  taux_recuperation_cents  integer not null default 0 check (taux_recuperation_cents >= 0),
  -- Dernière position connue, envoyée par son téléphone pendant une mission
  -- en cours (voir api/transporteur-position.js). Pas d'historique conservé.
  position_lat             double precision,
  position_lng             double precision,
  position_at              timestamptz,
  created_at               timestamptz not null default now()
);
create index transporteurs_city_idx on transporteurs (city_id, actif);
create index transporteurs_pin_idx on transporteurs (pin) where actif;

-- Zones d'intervention d'un transporteur pour la répartition automatique
-- (plusieurs zones possibles) — distinct de transporteurs.city_id qui reste
-- la "ville de rattachement" (équipe/paie/stats).
create table transporteur_villes (
  transporteur_id bigint not null references transporteurs(id) on delete cascade,
  city_id         bigint not null references cities(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (transporteur_id, city_id)
);
create index transporteur_villes_city_idx on transporteur_villes (city_id);

-- Disponibilité par jour de la semaine et moment de la journée.
-- jour : 0=dimanche … 6=samedi (aligné sur Date.getDay() JS et
-- extract(dow from ...) Postgres). moment : 'matin'/'apres_midi'/'journee'.
-- AUCUNE LIGNE pour un transporteur = disponible tous les jours, tous
-- moments (pas de restriction configurée).
create table transporteur_disponibilites (
  transporteur_id bigint not null references transporteurs(id) on delete cascade,
  jour            smallint not null check (jour between 0 and 6),
  moment          text not null default 'journee' check (moment in ('matin','apres_midi','journee')),
  created_at      timestamptz not null default now(),
  primary key (transporteur_id, jour, moment)
);

-- Espace partenaire (conciergeries, autres apporteurs d'affaires) : un
-- partenaire pose un lien d'affiliation (ex. locair.fr/?p=CODE) sur son
-- propre site, et touche une commission sur chaque réservation faite depuis
-- ce lien (voir reservations.partenaire_id ci-dessous).
create table partenaires (
  id                  bigint generated always as identity primary key,
  nom                 text not null, -- nom de la conciergerie/entreprise
  contact_nom         text,          -- personne de contact, si différent de "nom"
  email               text,
  telephone           text,
  -- Code utilisé dans le lien d'affiliation (ex. ?p=CODE) — public, visible
  -- dans l'URL. Distinct du PIN (secret, sert uniquement à se connecter).
  code                text not null unique,
  pin                 text not null unique,
  taux_commission_pct integer not null default 10 check (taux_commission_pct >= 0 and taux_commission_pct <= 100),
  actif               boolean not null default true,
  -- Coordonnées bancaires — saisies une fois, réutilisées à chaque virement.
  -- Le paiement reste manuel (voir partenaire_virements) ; déjà là pour
  -- brancher plus tard un vrai virement automatisé sans tout reconstruire.
  titulaire_compte    text,
  iban                text,
  bic                 text,
  created_at          timestamptz not null default now()
);
create index partenaires_code_idx on partenaires (code) where actif;
create index partenaires_pin_idx  on partenaires (pin)  where actif;

-- Un client peut réserver plusieurs fois — jusqu'ici chaque réservation était
-- une île isolée, aucune mémoire d'une fois sur l'autre. Déduplication par
-- téléphone (le plus stable : un client garde son numéro plus souvent que son
-- email). acces_difficile est une note libre ("digicode faux", "pas
-- d'ascenseur"...) qui enrichit la fiche pour la prochaine visite — jamais un
-- blocage, juste une info consultée par l'admin et le livreur.
create table clients (
  id                bigint generated always as identity primary key,
  city_id           bigint not null references cities(id),
  prenom            text,
  nom               text,
  tel               text,
  tel_normalise     text, -- chiffres uniquement, sert à la déduplication
  email             text,
  acces_difficile   text,
  created_at        timestamptz not null default now()
);
create index clients_city_tel_idx on clients (city_id, tel_normalise);

create table reservations (
  id                       bigint generated always as identity primary key,
  city_id                  bigint not null references cities(id),
  client_id                bigint references clients(id),
  ref                      text not null,
  stripe_payment_intent_id text unique,
  stripe_customer_id       text,
  prenom                   text,
  nom                      text,
  email                    text,
  tel                      text,
  tel_secondaire           text, -- numéro de secours si le principal ne répond pas (ex. client absent)
  type_client              text not null default 'particulier'
                             check (type_client in ('particulier','entreprise')),
  raison_sociale           text, -- nom de l'entreprise, si type_client = 'entreprise'
  siret                    text,
  adresse                  text,
  etage                    text,
  ascenseur                text,
  fenetre                  text,
  installation             text,
  instructions_acces       text, -- digicode, boîte à clés... saisi par le client sur le site
  creneau                  text, -- créneau de livraison choisi par le client sur le site (récupération = coordonnée par l'équipe, jamais choisie côté client)
  date_debut               date not null,
  date_fin                 date not null,
  quantite                 integer not null default 1 check (quantite > 0),
  prix_total_cents         integer not null default 0,
  statut                   text not null default 'en_attente'
                             check (statut in ('en_attente','confirmee','annulee','terminee','remboursee')),
  source                   text,
  source_channel           text, -- canal d'acquisition marketing (ex. 'google', 'instagram', 'bouche-a-oreille')
  parrain_code             text, -- code parrain saisi par le client (programme parrainage)
  -- Réservation apportée par un partenaire (conciergerie...) via son lien
  -- d'affiliation. Commission figée à la réservation (voir partenaires.taux_commission_pct),
  -- pour ne pas bouger rétroactivement si le taux change ensuite.
  partenaire_id            bigint references partenaires(id),
  partenaire_commission_cents integer not null default 0,
  partenaire_commission_payee boolean not null default false,
  logement                 text,
  motifs                   text,
  mkt_consent              boolean not null default false, -- opt-in marketing (RGPD)
  cgv_accepted_at          timestamptz, -- horodatage acceptation CGV (preuve légale)
  masquee                  boolean not null default false, -- retirée de la liste admin (ex. doublon), sans toucher au statut/stock
  created_at               timestamptz not null default now(),
  constraint reservations_dates_check check (date_fin > date_debut)
);
-- Seules les réservations actives/en attente comptent pour la disponibilité
create index reservations_avail_idx on reservations (city_id, date_debut, date_fin)
  where statut in ('en_attente','confirmee');
create index reservations_stripe_pi_idx on reservations (stripe_payment_intent_id);
create index reservations_partenaire_idx on reservations (partenaire_id) where partenaire_id is not null;

-- Trace d'audit des acceptations légales avant paiement (case CGV/CGL et case
-- conditions d'utilisation du climatiseur, cochées séparément côté site) — une
-- ligne par type par réservation, avec la version du document réellement
-- affichée au moment de l'acceptation (voir api/_lib/legal.js).
create table cgv_acceptations (
  id             bigint generated always as identity primary key,
  reservation_id bigint not null references reservations(id) on delete cascade,
  type           text not null check (type in ('cgv_location','conditions_utilisation')),
  version        text not null,
  accepted_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (reservation_id, type)
);
create index cgv_acceptations_reservation_idx on cgv_acceptations (reservation_id);

-- Quels appareils numérotés sont retenus pour quelle réservation. Rempli
-- automatiquement à la confirmation du paiement (voir api/_lib/reservations.js,
-- assign_appareils ci-dessous) — jamais à la création (une réservation encore
-- 'en_attente' peut être abandonnée, on ne bloque pas un appareil précis pour ça).
create table reservation_appareils (
  id             bigint generated always as identity primary key,
  reservation_id bigint not null references reservations(id) on delete cascade,
  appareil_id    bigint not null references appareils(id),
  created_at     timestamptz not null default now(),
  unique (reservation_id, appareil_id)
);
create index reservation_appareils_resa_idx on reservation_appareils (reservation_id);
create index reservation_appareils_app_idx  on reservation_appareils (appareil_id);

-- Une ligne = une mission terrain (livraison ou récupération).
-- Cycle de vie : a_faire -> acceptee -> arrivee -> fait | probleme
--                a_faire -> refusee (transporteur indisponible, à réassigner)
create table livraisons (
  id                     bigint generated always as identity primary key,
  reservation_id         bigint not null references reservations(id) on delete cascade,
  type                   text not null check (type in ('livraison','recuperation','changement')),
  transporteur_id        bigint references transporteurs(id),
  date_prevue            date not null,
  creneau                text,
  statut                 text not null default 'a_faire'
                           check (statut in ('a_faire','acceptee','refusee','arrivee','fait','probleme','annule')),
  -- Preuves terrain (chemins dans le bucket de stockage 'missions', jamais publics)
  photo_depart_path      text,   -- appareil au départ dépôt (livraison)
  photo_installation_path text,  -- appareil installé chez le client (livraison)
  photo_retour_path      text,   -- appareil récupéré chez le client (récupération)
  photo_absence_path     text,   -- preuve de passage devant le bâtiment (client absent)
  photo_fenetre_installee_path text, -- non utilisée : l'étape Installation ne demande finalement qu'une seule photo (climatiseur + fenêtre + télécommande visibles ensemble), voir photo_installation_path
  photo_telecommande_path text,  -- non utilisée, même raison que ci-dessus
  demo_faite             boolean not null default false, -- fonctionnement montré au client (étape Installation)
  demo_faite_at          timestamptz,
  vidange_confirmee      boolean not null default false, -- vérification + vidange du climatiseur, faite chez le client à la récupération (~5 min)
  vidange_at             timestamptz,
  probleme_type          text check (probleme_type in ('client_absent','appareil_en_panne','retard','autre')),
  probleme_description   text,
  notes                  text,
  -- Rémunération du transporteur pour cette mission (figée au moment du "fait"
  -- pour ne pas bouger rétroactivement si le taux change ensuite)
  montant_du_cents       integer not null default 0,
  paye                   boolean not null default false,
  accepted_at            timestamptz,
  client_notifie_at      timestamptz, -- message envoyé au client ~30 min avant l'arrivée
  arrivee_at             timestamptz,
  fait_at                timestamptz,
  probleme_at            timestamptz,
  masquee                boolean not null default false, -- retirée de l'écran admin (ménage manuel), sans toucher au statut
  created_at             timestamptz not null default now()
);
create index livraisons_date_idx on livraisons (date_prevue, statut);
create index livraisons_transporteur_idx on livraisons (transporteur_id, statut);

-- Bucket privé pour les photos/vidéos de mission — accès uniquement via URL signée
-- générée côté serveur (clé service-role). Aucune policy publique nécessaire.
insert into storage.buckets (id, name, public) values ('missions', 'missions', false);

-- Checklist matériel "à récupérer au box" — une validation par transporteur
-- et par jour. L'existence d'une ligne = checklist prise en charge ; la
-- supprimer revient à annuler la prise en charge (bouton "Retour").
create table checklist_box (
  id              bigint generated always as identity primary key,
  transporteur_id bigint not null references transporteurs(id) on delete cascade,
  date            date not null,
  validated_at    timestamptz not null default now(),
  unique (transporteur_id, date)
);
create index checklist_box_transporteur_idx on checklist_box (transporteur_id, date);

-- Bibliothèque de tutoriels vidéo (prise en main transporteur) — vidéos
-- catégorisées, uploadées par l'admin. Bibliothèque unique, non liée à une
-- ville.
create table tutoriel_videos (
  id             bigint generated always as identity primary key,
  categorie      text not null check (categorie in (
                   'acces_sortie_boxe','recuperation_materiel','fermeture_boxe',
                   'entree_sortie_centre','chargement','dechargement','installation'
                 )),
  -- Catégorie 7 (installation) seulement : porte fenêtre / fenêtre battante /
  -- porte coulissante / volet. Pas de check() sur les valeurs — détail exact
  -- laissé à l'étape future qui remplira cette catégorie.
  sous_categorie text,
  titre          text not null,
  -- null tant qu'aucun fichier n'est uploadé (slot de métadonnées créé à
  -- l'avance par l'admin, avant d'avoir la vidéo elle-même).
  storage_path   text,
  ordre          integer not null default 0,
  actif          boolean not null default true,
  created_at     timestamptz not null default now()
);
create index tutoriel_videos_categorie_idx on tutoriel_videos (categorie, ordre);

-- L'existence d'une ligne = vue en entier au moins une fois par ce
-- transporteur — même convention que checklist_box (ligne = événement).
create table tutoriel_vus (
  transporteur_id bigint not null references transporteurs(id) on delete cascade,
  video_id        bigint not null references tutoriel_videos(id) on delete cascade,
  vu_complet_at   timestamptz not null default now(),
  primary key (transporteur_id, video_id)
);

-- Contrat + facture PDF, générés automatiquement une seule fois à la
-- confirmation du paiement Stripe (jamais à l'installation, jamais
-- régénérés pour une facture déjà existante — voir api/_lib/documents.js).
-- Fichiers stockés dans le bucket "missions" existant (préfixe documents/).
create table documents (
  id                bigint generated always as identity primary key,
  reservation_id    bigint not null references reservations(id) on delete cascade,
  type              text not null check (type in ('contrat','facture')),
  numero            text,
  version           text not null,
  storage_path      text not null,
  access_token      text not null unique,
  montant_ttc_cents integer not null default 0,
  statut            text not null default 'genere' check (statut in ('genere','envoye','consulte')),
  genere_at         timestamptz not null default now(),
  envoye_at         timestamptz,
  consulte_at       timestamptz,
  created_at        timestamptz not null default now()
);
create unique index documents_facture_unique_idx on documents (reservation_id) where type = 'facture';
create index documents_reservation_idx on documents (reservation_id);
create index documents_access_token_idx on documents (access_token);

-- Numérotation séquentielle des factures par année, sans rupture (obligation
-- légale) — verrou de ligne via ON CONFLICT DO UPDATE, atomique même en cas
-- d'appels concurrents.
create table facture_compteur (
  annee          integer primary key,
  dernier_numero integer not null default 0
);

create or replace function next_invoice_number(p_annee integer) returns integer
language plpgsql as $$
declare
  v_numero integer;
begin
  insert into facture_compteur (annee, dernier_numero) values (p_annee, 1)
    on conflict (annee) do update set dernier_numero = facture_compteur.dernier_numero + 1
  returning dernier_numero into v_numero;
  return v_numero;
end;
$$;

-- Demandes de virement transporteur. Le montant réel et le passage à 'verse'
-- sont toujours déclenchés par le propriétaire (voir api/admin-virements.js) —
-- aucun virement bancaire n'est automatisé.
create table virements (
  id             bigint generated always as identity primary key,
  transporteur_id bigint not null references transporteurs(id),
  montant_cents  integer not null default 0,
  statut         text not null default 'demande' check (statut in ('demande','verse')),
  created_at     timestamptz not null default now(),
  verse_at       timestamptz
);
create index virements_transporteur_idx on virements (transporteur_id, statut);

-- Demandes de virement partenaire — même logique que `virements` ci-dessus,
-- mais table séparée pour ne rien toucher à ce circuit transporteur déjà en
-- prod. Voir api/admin-partenaire-virements.js.
create table partenaire_virements (
  id            bigint generated always as identity primary key,
  partenaire_id bigint not null references partenaires(id),
  montant_cents integer not null default 0,
  statut        text not null default 'demande' check (statut in ('demande','verse')),
  created_at    timestamptz not null default now(),
  verse_at      timestamptz
);
create index partenaire_virements_partenaire_idx on partenaire_virements (partenaire_id, statut);

create table incidents (
  id                    bigint generated always as identity primary key,
  city_id               bigint references cities(id), -- indispensable dès qu'une 2e ville partage cette base
  reservation_id        bigint references reservations(id) on delete set null,
  type                  text not null check (type in ('retard','materiel','autre')),
  description           text,
  montant_facture_cents integer not null default 0,
  statut                text not null default 'ouvert' check (statut in ('ouvert','facture','resolu')),
  created_at            timestamptz not null default now()
);
create index incidents_reservation_idx on incidents (reservation_id);
create index incidents_city_idx on incidents (city_id, statut);

-- Dernier incident déclenché par CETTE mission (client absent, retard...),
-- utilisé pour le refermer automatiquement quand la mission se termine
-- normalement. Ne remplace pas incidents.reservation_id (toujours utilisé
-- par ailleurs) : lien plus précis, mission par mission.
alter table livraisons add column incident_id bigint references incidents(id) on delete set null;

-- Disponibilité = appareils actifs (hors panne/maintenance) moins :
--  - les réservations 'en_attente' récentes (< 30 min, paiement en cours, pas
--    encore d'appareil précis assigné) qui chevauchent la période demandée ;
--  - les appareils déjà retenus par une réservation confirmée qui chevauche
--    la période demandée.
-- Compte par quantité (pas par appareil précis) côté 'en_attente' car on ne
-- veut pas réserver un numéro précis pour un panier qui peut être abandonné.
create or replace function available_units(p_city_id bigint, p_date_debut date, p_date_fin date)
returns integer
language sql
stable
as $$
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

-- Assigne p_quantite appareils (les plus petits numéros libres d'abord) à une
-- réservation confirmée : exclut panne/maintenance et les appareils déjà
-- retenus par une AUTRE réservation confirmée qui chevauche la même période.
-- "for update skip locked" évite qu'un webhook Stripe redélivré en parallèle
-- assigne deux fois le même appareil.
create or replace function assign_appareils(p_reservation_id bigint, p_city_id bigint, p_quantite integer, p_date_debut date, p_date_fin date)
returns setof appareils
language plpgsql
as $$
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

-- Abonnements aux notifications push du navigateur (un transporteur peut avoir
-- plusieurs appareils/onglets). "endpoint" identifie de façon unique un
-- abonnement navigateur ; le réabonner (même endpoint) met juste à jour les clés.
create table push_subscriptions (
  id              bigint generated always as identity primary key,
  transporteur_id bigint not null references transporteurs(id) on delete cascade,
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  created_at      timestamptz not null default now()
);
create index push_subscriptions_transporteur_idx on push_subscriptions (transporteur_id);

-- Idem côté admin — pas de colonne propriétaire, l'admin n'a qu'un seul
-- compte partagé (mot de passe), pas d'identité par utilisateur.
create table admin_push_subscriptions (
  id         bigint generated always as identity primary key,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- Authentification biométrique (Face ID / empreinte) via le standard WebAuthn,
-- comme n'importe quelle app bancaire côté web. Un transporteur peut enregistrer
-- plusieurs appareils. La clé publique ne permet jamais de retrouver le PIN ni
-- de se faire passer pour quelqu'un d'autre sans le capteur biométrique physique.
create table webauthn_credentials (
  id              bigint generated always as identity primary key,
  transporteur_id bigint not null references transporteurs(id) on delete cascade,
  credential_id   text not null unique,
  public_key      text not null,
  counter         bigint not null default 0,
  device_type     text,
  backed_up       boolean not null default false,
  created_at      timestamptz not null default now()
);
create index webauthn_credentials_transporteur_idx on webauthn_credentials (transporteur_id);

-- Challenges WebAuthn à usage unique, courte durée de vie (~5 min). Pas de lien
-- vers un transporteur à la génération : la connexion biométrique ne demande pas
-- de PIN au préalable, l'identité est déduite du "credential_id" renvoyé par
-- l'appareil au moment de la vérification.
create table webauthn_challenges (
  id         bigint generated always as identity primary key,
  challenge  text not null unique,
  created_at timestamptz not null default now()
);

-- Face ID / empreinte pour l'espace admin — un seul admin (mot de passe
-- unique), donc pas de colonne de rattachement comme pour les transporteurs :
-- chaque ligne est juste un appareil autorisé (téléphone, ordinateur...).
create table admin_webauthn_credentials (
  id            bigint generated always as identity primary key,
  credential_id text not null unique,
  public_key    text not null,
  counter       bigint not null default 0,
  device_type   text,
  backed_up     boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Seed pour Nice — ajuster le nombre d'appareils insérés ci-dessous au vrai
-- parc, et postal_codes à la zone de livraison réelle une fois affinée
-- (voir onglet Villes de l'admin).
insert into cities (slug, name, dep, postal, postal_codes) values ('nice', 'Nice', '06', '06300', array['06300']);
insert into appareils (city_id, numero)
  select id, n from cities, generate_series(1, 3) as n where slug = 'nice';
-- Références produit connues (à compléter au fur et à mesure — voir /admin → Stock
-- pour en ajouter/modifier directement sans repasser par ce fichier)
update appareils set reference = 'SN 5400L478501B12902K0132'
  where numero = 3 and city_id = (select id from cities where slug = 'nice');
