-- QR client sur chaque climatiseur (demande d'Aly, 2026-09-16) : un jeton
-- opaque par appareil, imprimé sur l'étiquette collée dessus, qui redirige
-- le client vers son espace (prolongation, changement de créneau de
-- récupération) sans avoir à retaper son numéro de commande.
-- Volontairement séparé du numéro d'appareil déjà utilisé pour le QR
-- d'inventaire interne (admin/index.html printStockLabels) : un numéro se
-- devine (1, 2, 3…), un jeton aléatoire non. Nullable — généré à la demande
-- (api/admin-stock.js, action 'ensure_qr_tokens'), jamais en bloc ici.
alter table appareils add column if not exists qr_token text;
create unique index if not exists appareils_qr_token_idx on appareils (qr_token) where qr_token is not null;
