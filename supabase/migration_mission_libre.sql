-- ─────────────────────────────────────────────────────────────────────────────
-- Migration : missions "autre" (hors réservation client) — ex. aller chercher
-- du matériel livré par un fournisseur et le ramener au box. Tarif fixé
-- librement par l'admin à la création (pas de barème pour ce type).
-- À exécuter dans Supabase → SQL Editor (une seule fois)
-- ─────────────────────────────────────────────────────────────────────────────

-- Une mission "autre" n'a pas de réservation d'origine.
alter table livraisons alter column reservation_id drop not null;

-- Nouveau type autorisé, en plus des 3 existants.
alter table livraisons drop constraint if exists livraisons_type_check;
alter table livraisons add constraint livraisons_type_check
  check (type in ('livraison', 'recuperation', 'changement', 'autre'));

-- Titre + adresse libres (une mission "autre" n'a pas de client dont tirer
-- ces infos) ; city_id direct car il n'y a pas de réservation pour le déduire.
alter table livraisons add column if not exists titre text;
alter table livraisons add column if not exists adresse_libre text;
alter table livraisons add column if not exists city_id bigint references cities(id);
