-- Click & Collect — retour en 15 secondes : photo du climatiseur dans sa
-- housse (preuve du dépôt) et état de l'appareil après le retour.
-- etat_retour : 'a_reconditionner' (rendu, à remettre en état) puis 'pret'
-- (reconditionné, peut repartir). Page : admin/cc-retours.html.
-- À coller UNE FOIS dans Supabase → SQL Editor. Le site marche aussi sans :
-- la photo part alors dans les consignes de la réservation.
alter table reservations add column if not exists retour_photo text;
alter table reservations add column if not exists etat_retour text;
create index if not exists reservations_cc_a_reconditionner_idx on reservations (etat_retour)
  where etat_retour = 'a_reconditionner';
