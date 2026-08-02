-- Hachage progressif des PINs transporteurs — même migration que pour
-- partenaires et admin_users (colonne pin_hashed). Idempotent, sans risque à rejouer.
alter table transporteurs add column if not exists pin_hashed boolean not null default false;
