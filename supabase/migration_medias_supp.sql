-- Photos/vidéos supplémentaires attachées à une mission, en plus de la preuve
-- obligatoire (photo_installation_path etc.) — ajoutées à n'importe quel
-- moment, prises en direct ou choisies depuis la galerie du téléphone,
-- par le transporteur ou par l'admin. Idempotent — sans risque à rejouer.

create table if not exists mission_medias (
  id           bigint generated always as identity primary key,
  livraison_id bigint not null references livraisons(id) on delete cascade,
  type         text not null check (type in ('photo','video')),
  path         text not null,
  uploaded_by  text not null check (uploaded_by in ('transporteur','admin')),
  created_at   timestamptz not null default now()
);
create index if not exists mission_medias_livraison_idx on mission_medias (livraison_id);
