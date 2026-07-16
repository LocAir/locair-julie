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

-- Catalogue des modèles de climatiseur (Rowenta, Frico...) — une fiche par
-- modèle, réutilisée par tous les appareils physiques de ce modèle (jamais
-- dupliquée par appareil). Alimente la section "Mon climatiseur" de l'espace
-- client (Module 4).
create table modeles_climatiseur (
  id                   bigint generated always as identity primary key,
  marque               text not null,
  modele               text not null,
  puissance_btu        text,
  surface_max_m2       text,
  niveau_sonore_db     text,
  classe_energie       text,
  photo_url            text,
  conseils_utilisation text,
  video_tutoriel_url   text,
  documentation_url    text,
  actif                boolean not null default true,
  created_at           timestamptz not null default now()
);

-- Un appareil physique = une ligne, numérotée (étiquette à coller dessus).
-- 'panne'/'maintenance' l'excluent définitivement du calcul de disponibilité
-- jusqu'à ce qu'un admin le repasse en 'disponible'. Il n'y a pas de statut
-- "loué" stocké ici : le fait qu'un appareil soit actuellement chez un client
-- se déduit de reservation_appareils (voir plus bas), pour ne jamais avoir à
-- le remettre à jour manuellement au retour du client.
create table appareils (
  id          bigint generated always as identity primary key,
  city_id     bigint not null references cities(id),
  numero      integer not null,
  statut      text not null default 'disponible' check (statut in ('disponible','panne','maintenance','loue','nettoyage')),
  localisation text not null default 'stock_principal'
                check (localisation in ('stock_principal','vehicule_transporteur','chez_client','maintenance','autre')),
  reference   text, -- référence produit du fabricant (ex. "RWAC10KA+"), saisie librement par l'admin
  modele_id   bigint references modeles_climatiseur(id), -- fiche catalogue affichée côté espace client (nullable = description générique)
  notes       text,
  created_at  timestamptz not null default now(),
  unique (city_id, numero)
);
create index appareils_city_statut_idx on appareils (city_id, statut);

-- Historique des mouvements de stock (Module 6) — "aucun mouvement ne doit
-- être invisible" : chaque changement de statut/localisation d'un
-- climatiseur crée un événement, jamais un simple écrasement silencieux.
-- livraison_id/reservation_id ajoutées plus bas par alter table, une fois
-- livraisons/reservations définies (elles viennent après dans ce fichier).
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
  utilisateur           text, -- nom du transporteur, "admin", ou "systeme" (automatique)
  commentaire           text,
  -- Coût de l'intervention si renseigné par l'admin (mouvement "passage
  -- maintenance") — sert au calcul de rentabilité par appareil (Partie 10).
  cout_cents            integer check (cout_cents is null or cout_cents >= 0),
  created_at            timestamptz not null default now()
);
create index appareil_mouvements_appareil_idx on appareil_mouvements (appareil_id, created_at desc);

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
  -- Réconciliation : commission déjà versée mais réservation ensuite annulée
  -- ou remboursée — l'admin coche une fois que c'est réglé de son côté
  -- (récupéré auprès du partenaire, ou déduit du prochain virement).
  partenaire_litige_resolu boolean not null default false,
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
  -- Validation administrative (Module 6, Partie 6) : "réservé en attente
  -- validation" (valide=false) -> "réservation confirmée" (valide=true).
  -- Oversight uniquement — ne bloque jamais la confirmation automatique ni
  -- la création des missions transporteur, déjà protégées contre tout
  -- chevauchement par available_units()/assign_appareils() ci-dessous.
  valide         boolean not null default false,
  valide_at      timestamptz,
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
                           check (statut in ('a_faire','acceptee','refusee','en_route','arrivee','fait','probleme','annule')),
  depart_at              timestamptz, -- heure de "Commencer la mission/récupération" (statut en_route)
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
  -- Checklists administrables (checklist_items), réponses figées au moment de
  -- la validation de mission — traçabilité même si la liste évolue ensuite.
  checklist_installation_reponses  jsonb,
  checklist_recuperation_reponses  jsonb,
  -- Contrôle d'état du matériel, renseigné à la récupération
  etat_materiel          text check (etat_materiel in ('parfait_etat','usure_normale','nettoyage_necessaire','maintenance_necessaire','hors_service')),
  etat_materiel_commentaire text,
  probleme_type          text check (probleme_type in ('client_absent','acces_impossible','mauvaise_adresse','materiel_endommage','probleme_technique','refus_client','retard','autre')),
  probleme_description   text,
  notes                  text,
  -- Rémunération du transporteur pour cette mission (figée au moment du "fait"
  -- pour ne pas bouger rétroactivement si le taux change ensuite)
  montant_du_cents       integer not null default 0,
  -- Validation humaine par l'administration, requise avant d'être payable
  -- (voir api/admin-virements.js) — "payé" implique toujours "validé".
  valide                 boolean not null default false,
  valide_at              timestamptz,
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

-- Checklists administrables faites CHEZ LE CLIENT avant de valider une
-- mission ("Installation terminée" / "Récupération terminée") — distinctes
-- de checklist_box ci-dessus (matériel à prendre au box avant de partir).
-- Réponses figées au moment de la validation : voir livraisons.checklist_*.
create table checklist_items (
  id         bigint generated always as identity primary key,
  workflow   text not null check (workflow in ('installation','recuperation','preparation')),
  libelle    text not null,
  ordre      integer not null default 0,
  actif      boolean not null default true,
  created_at timestamptz not null default now()
);
create index checklist_items_workflow_idx on checklist_items (workflow, actif, ordre);

insert into checklist_items (workflow, libelle, ordre) values
  ('installation', 'Climatiseur installé', 1),
  ('installation', 'Gaine installée correctement', 2),
  ('installation', 'Kit de calfeutrage installé (si prévu)', 3),
  ('installation', 'Test de fonctionnement effectué', 4),
  ('installation', 'Explication d''utilisation donnée au client', 5),
  ('recuperation', 'Appareil récupéré', 1),
  ('recuperation', 'Télécommande récupérée', 2),
  ('recuperation', 'Gaine récupérée', 3),
  ('recuperation', 'Kit de calfeutrage récupéré', 4),
  ('recuperation', 'Notice récupérée', 5),
  -- Checklist de préparation avant livraison (Module 6, Partie 7).
  ('preparation', 'Climatiseur correspondant sélectionné', 1),
  ('preparation', 'État contrôlé', 2),
  ('preparation', 'Télécommande présente', 3),
  ('preparation', 'Gaine présente', 4),
  ('preparation', 'Kit de calfeutrage présent', 5),
  ('preparation', 'Notice présente', 6),
  ('preparation', 'Appareil propre', 7);

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

-- Catalogue des scénarios email client (moteur central, voir
-- api/_lib/emailEngine.js) — permet de désactiver un scénario depuis
-- l'administration sans toucher au code.
create table email_scenarios (
  id         text primary key,
  libelle    text not null,
  actif      boolean not null default true,
  created_at timestamptz not null default now()
);
insert into email_scenarios (id, libelle) values
  ('confirmation',        'Confirmation de réservation'),
  ('suivi_j14',           'Suivi J-14'),
  ('preparation_j3',      'Préparation J-3'),
  ('rappel_j1',           'Rappel J-1 (livraison)'),
  ('post_installation',   'Post-installation'),
  ('avant_fin_location',  'Avant fin de location (prolongation)'),
  ('rappel_recuperation', 'Rappel J-1 (récupération)'),
  ('fin_location',        'Fin de location (avis)');

-- Garantit qu'un scénario n'est jamais envoyé deux fois pour la même
-- réservation (clé primaire composite).
create table email_sent (
  reservation_id bigint not null references reservations(id) on delete cascade,
  scenario       text not null references email_scenarios(id),
  sent_at        timestamptz not null default now(),
  primary key (reservation_id, scenario)
);

-- Historique complet de chaque tentative d'envoi (succès ou échec). canal
-- distingue email/SMS — les envois ponctuels hors moteur (confirmation SMS,
-- prolongation, contrat/facture, mission acceptée, client absent) y sont
-- aussi enregistrés en best-effort (jamais bloquant) pour que la fiche
-- client montre un historique complet, pas seulement les 8 scénarios email.
create table email_log (
  id             bigint generated always as identity primary key,
  reservation_id bigint references reservations(id) on delete cascade,
  scenario       text not null,
  canal          text not null default 'email' check (canal in ('email','sms')),
  destinataire   text,
  modele         text,
  statut         text not null check (statut in ('envoye','erreur')),
  erreur         text,
  -- Contenu réel envoyé (HTML pour un email, texte brut pour un SMS) — permet
  -- un aperçu fidèle à 100% depuis la fiche client, même si le modèle a
  -- changé depuis. Nullable : les lignes créées avant cette colonne n'ont
  -- pas d'aperçu disponible, ce qui est acceptable (historique ancien).
  contenu        text,
  created_at     timestamptz not null default now()
);
create index email_log_reservation_idx on email_log (reservation_id, created_at desc);
create index email_log_scenario_idx on email_log (scenario);

-- Exclusion d'un envoi précis à venir (fiche client admin, panneau
-- Communications) — une ligne = ce scénario ne partira jamais pour cette
-- réservation. `action` est purement informatif pour l'affichage ("en
-- pause" vs "supprimé") : le mécanisme de blocage est identique dans les
-- deux cas, voir wasScenarioSkipped() dans api/_lib/emailEngine.js.
create table email_skip (
  reservation_id bigint not null references reservations(id) on delete cascade,
  scenario       text not null references email_scenarios(id),
  action         text not null default 'suppression' check (action in ('pause','suppression')),
  created_at     timestamptz not null default now(),
  primary key (reservation_id, scenario)
);

-- Signature email administrable (nom expéditeur, fonction, logo,
-- coordonnées, site) — une seule ligne, indépendante de la signature du
-- webmail IONOS.
create table email_signature (
  id             integer primary key default 1,
  nom_expediteur text not null default 'Loc''Air',
  fonction       text,
  logo_url       text,
  telephone      text,
  email          text not null default 'contact@locair.fr',
  site_web       text default 'https://www.locair.fr',
  updated_at     timestamptz not null default now(),
  constraint email_signature_single_row check (id = 1)
);
insert into email_signature (id) values (1);

-- Centre d'aide client (espace client, Module 4) — contenu administrable,
-- structuré par slug/catégorie pour rester exploitable par un futur
-- assistant IA (recherche par mots-clés) sans développement de chatbot en V1.
create table centre_aide_articles (
  id         bigint generated always as identity primary key,
  slug       text not null unique,
  categorie  text,
  titre      text not null,
  contenu    text not null,
  ordre      integer not null default 0,
  actif      boolean not null default true,
  created_at timestamptz not null default now()
);

-- Coordonnées d'assistance affichées dans l'espace client — une seule ligne,
-- jamais codées en dur dans le front.
create table assistance_config (
  id         integer primary key default 1,
  horaires   text default 'Tous les jours, 8h–20h',
  telephone  text default '06 63 79 87 56',
  email      text default 'contact@locair.fr',
  urgence    text default 'En cas de panne, contactez-nous directement par téléphone ou WhatsApp.',
  updated_at timestamptz not null default now(),
  constraint assistance_config_single_row check (id = 1)
);
insert into assistance_config (id) values (1);

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
  -- Pense-bête, ne bloque jamais le virement : une commission versée est une
  -- prestation entre deux entreprises, qui devrait donner lieu à une facture
  -- de la part du partenaire.
  facture_recue boolean not null default false,
  created_at    timestamptz not null default now(),
  verse_at      timestamptz
);
create index partenaire_virements_partenaire_idx on partenaire_virements (partenaire_id, statut);

create table incidents (
  id                    bigint generated always as identity primary key,
  city_id               bigint references cities(id), -- indispensable dès qu'une 2e ville partage cette base
  reservation_id        bigint references reservations(id) on delete set null,
  transporteur_id       bigint references transporteurs(id),
  livraison_id          bigint references livraisons(id) on delete set null, -- mission précise à l'origine de l'incident
  type                  text not null check (type in ('client_absent','acces_impossible','mauvaise_adresse','materiel_endommage','probleme_technique','refus_client','retard','autre')),
  description           text,
  photos                text[], -- chemins dans le bucket 'missions', si le transporteur en a joint
  montant_facture_cents integer not null default 0,
  -- 'retard_a_facturer' = anciennement 'facture' : incident de retard dont la
  -- facturation client reste à faire (voir api/charge-retard.js).
  statut                text not null default 'nouveau' check (statut in ('nouveau','en_analyse','retard_a_facturer','resolu','clos')),
  created_at            timestamptz not null default now()
);
create index incidents_reservation_idx on incidents (reservation_id);
create index incidents_city_idx on incidents (city_id, statut);

-- Dernier incident déclenché par CETTE mission (client absent, retard...),
-- utilisé pour le refermer automatiquement quand la mission se termine
-- normalement. Ne remplace pas incidents.reservation_id (toujours utilisé
-- par ailleurs) : lien plus précis, mission par mission.
alter table livraisons add column incident_id bigint references incidents(id) on delete set null;

-- Liens différés de appareil_mouvements (défini plus haut, avant livraisons
-- et reservations dans ce fichier).
alter table appareil_mouvements add column livraison_id   bigint references livraisons(id) on delete set null;
alter table appareil_mouvements add column reservation_id bigint references reservations(id) on delete set null;

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

-- Centre de notifications interne transporteur — persisté (lu/non lu,
-- historique), en complément du push navigateur ci-dessus qui reste éphémère.
create table transporteur_notifications (
  id              bigint generated always as identity primary key,
  transporteur_id bigint not null references transporteurs(id) on delete cascade,
  type            text not null check (type in ('nouvelle_mission','modification','annulation','incident','validation','paiement')),
  message         text not null,
  livraison_id    bigint references livraisons(id) on delete set null,
  lu              boolean not null default false,
  lu_at           timestamptz,
  created_at      timestamptz not null default now()
);
create index transporteur_notifications_idx on transporteur_notifications (transporteur_id, lu, created_at desc);

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

-- Comptes équipe (Module 7, Partie 31) : en plus du mot de passe historique
-- partagé (ADMIN_PASSWORD, toujours valide, vaut le rôle "administrateur"),
-- de vrais comptes nominatifs avec un rôle qui limite ce qu'ils voient.
create table admin_users (
  id            serial primary key,
  nom           text not null,
  email         text,
  pin           text not null unique,
  role          text not null check (role in ('administrateur','operateur','comptabilite','support_client')),
  actif         boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
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
