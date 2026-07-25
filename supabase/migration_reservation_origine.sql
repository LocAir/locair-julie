-- Lien fiable entre une réservation de prolongation et la réservation
-- qu'elle prolonge — jusqu'ici reconstitué a posteriori par coïncidence de
-- dates (date_fin de l'origine === date_fin de sa prolongation), ce qui
-- laissait un risque théorique de confusion entre deux séjours indépendants
-- du même client si leurs dates coïncidaient par hasard. Colonne nullable :
-- les réservations déjà en base (avant cette migration) restent NULL, et le
-- code continue de les traiter avec l'ancienne méthode par date en repli
-- (voir isSupersededReservation, api/_lib/emailSchedule.js).
alter table reservations
  add column if not exists reservation_origine_id bigint references reservations(id) on delete set null;

create index if not exists idx_reservations_origine on reservations(reservation_origine_id) where reservation_origine_id is not null;
