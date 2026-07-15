-- ================================================================
-- MODULE 5 — Espace transporteur V2
-- Enrichit l'espace transporteur existant (aucune table remplacée) :
-- étape "en route" avant arrivée, checklists administrables
-- (installation + récupération), contrôle d'état du matériel au
-- retour, types/statuts d'incidents étendus, validation humaine de
-- la rémunération avant paiement, centre de notifications interne.
-- ================================================================

-- --- Étape "En route" avant "Arrivé sur place" (livraison + récupération) ---
-- "arrivee" existait déjà comme statut (legacy, plus jamais émis) : on le
-- réactive comme étape 3, précédée d'une nouvelle étape "en_route" (étape 2).
alter table livraisons drop constraint livraisons_statut_check;
alter table livraisons add constraint livraisons_statut_check
  check (statut in ('a_faire','acceptee','refusee','en_route','arrivee','fait','probleme','annule'));
alter table livraisons add column depart_at timestamptz; -- heure de "Commencer la mission/récupération"

-- --- Checklists administrables (installation + récupération) ---
-- Ne remplace PAS la checklist de départ "au box" (checklist_box, conservée
-- telle quelle) : ceci concerne les checklists faites CHEZ LE CLIENT, avant
-- de valider "Installation terminée" / "Récupération terminée".
create table checklist_items (
  id         bigint generated always as identity primary key,
  workflow   text not null check (workflow in ('installation','recuperation')),
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
  ('recuperation', 'Notice récupérée', 5);

-- Réponses figées au moment de la validation de mission (traçabilité —
-- snapshot de ce qui était coché ce jour-là, même si la liste évolue après).
alter table livraisons add column checklist_installation_reponses jsonb;
alter table livraisons add column checklist_recuperation_reponses jsonb;

-- --- Contrôle d'état du matériel à la récupération ---
alter table livraisons add column etat_materiel text
  check (etat_materiel in ('parfait_etat','usure_normale','nettoyage_necessaire','maintenance_necessaire','hors_service'));
alter table livraisons add column etat_materiel_commentaire text;

-- --- Parc climatiseurs : nouvel état "nettoyage nécessaire" ---
alter table appareils drop constraint appareils_statut_check;
alter table appareils add constraint appareils_statut_check
  check (statut in ('disponible','panne','maintenance','loue','nettoyage'));

-- --- Types de problème transporteur étendus ---
-- 'appareil_en_panne' renommé 'materiel_endommage' (vocabulaire du cahier des
-- charges) ; 'retard' conservé (facturation retard client, inchangée).
alter table livraisons drop constraint livraisons_probleme_type_check;
update livraisons set probleme_type = 'materiel_endommage' where probleme_type = 'appareil_en_panne';
alter table livraisons add constraint livraisons_probleme_type_check
  check (probleme_type in ('client_absent','acces_impossible','mauvaise_adresse','materiel_endommage','probleme_technique','refus_client','retard','autre'));

-- --- Incidents : types précis + statuts + liens mission/transporteur/photos ---
alter table incidents add column transporteur_id bigint references transporteurs(id);
alter table incidents add column livraison_id bigint references livraisons(id) on delete set null;
alter table incidents add column photos text[];

alter table incidents drop constraint incidents_type_check;
update incidents set type = 'materiel_endommage' where type = 'materiel';
alter table incidents add constraint incidents_type_check
  check (type in ('client_absent','acces_impossible','mauvaise_adresse','materiel_endommage','probleme_technique','refus_client','retard','autre'));

-- 'facture' -> 'retard_a_facturer' (même sens, libellé plus clair côté admin,
-- décision du propriétaire) ; 'ouvert' -> 'nouveau' ; 'en_analyse' et 'clos'
-- sont deux statuts nouveaux, à choisir manuellement par l'administration.
alter table incidents drop constraint incidents_statut_check;
update incidents set statut = 'nouveau' where statut = 'ouvert';
update incidents set statut = 'retard_a_facturer' where statut = 'facture';
alter table incidents add constraint incidents_statut_check
  check (statut in ('nouveau','en_analyse','retard_a_facturer','resolu','clos'));
alter table incidents alter column statut set default 'nouveau';

-- --- Rémunération : validation humaine obligatoire avant paiement ---
-- 3 états : en attente (valide=false) -> validé par l'administration
-- (valide=true, paye=false) -> payé (paye=true, implique valide=true).
alter table livraisons add column valide boolean not null default false;
alter table livraisons add column valide_at timestamptz;
-- Les missions déjà payées avant ce module sont considérées validées de fait.
update livraisons set valide = true, valide_at = fait_at where paye = true;

-- --- Centre de notifications transporteur (persisté, en plus du push) ---
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
