-- Hachage progressif des PINs admin_users — même migration que pour
-- partenaires (colonne pin_hashed). Idempotent, sans risque à rejouer.
alter table admin_users add column if not exists pin_hashed boolean not null default false;
