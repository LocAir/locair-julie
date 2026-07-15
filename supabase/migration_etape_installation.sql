-- ─────────────────────────────────────────────────────────────────────────────
-- Étape "Installation" (parcours transporteur, mission livraison) : 3 photos
-- de preuve + confirmation de démonstration au client, et clôture automatique
-- d'un incident quand la mission qui l'avait déclenché se termine normalement.
-- À exécuter dans Supabase → SQL Editor (une seule fois)
-- ─────────────────────────────────────────────────────────────────────────────

alter table livraisons add column if not exists photo_fenetre_installee_path text; -- photo fenêtre + calfeutrage en place
alter table livraisons add column if not exists photo_telecommande_path text;      -- photo télécommande fournie au client
alter table livraisons add column if not exists demo_faite boolean not null default false; -- fonctionnement montré au client
alter table livraisons add column if not exists demo_faite_at timestamptz;

-- Dernier incident déclenché par CETTE mission (client absent, retard...),
-- utilisé pour le refermer automatiquement quand la mission se termine
-- normalement. Ne remplace pas incidents.reservation_id (toujours utilisé
-- par ailleurs) : lien plus précis, mission par mission.
alter table livraisons add column if not exists incident_id bigint references incidents(id) on delete set null;
