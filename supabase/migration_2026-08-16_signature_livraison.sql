-- Signature client au moment de l'installation (Module transporteur)
-- À coller dans Supabase → SQL Editor AVANT de merger la PR correspondante.
-- Ce script est idempotent.

-- Colonne pour stocker le chemin du PNG de signature dans le bucket "missions"
alter table livraisons add column if not exists signature_client_path text;
-- Horodatage de la signature (utile pour les litiges et le suivi)
alter table livraisons add column if not exists signature_client_at timestamptz;
