-- ================================================================
-- Restaure les 2 codes promo historiques (LOCAIR10, LOCA10 — 10 € de
-- réduction fixe) dans la nouvelle table `promotions`. Trouvé lors d'un
-- audit (2026-08-06) : le passage au nouveau système de codes promo a
-- supprimé le PROMO_CODES codé en dur côté serveur (api/checkout.js) sans
-- recréer ces deux codes dans la nouvelle table — le site continuait de
-- promettre "10 € déduits" pour ces deux codes (aperçu client), mais le
-- serveur ne les reconnaissait plus du tout, donc n'appliquait aucune
-- réduction. Personne n'a payé plus cher que le prix affiché à l'écran
-- (le montant réel vient toujours du serveur), mais la réduction promise
-- n'était plus appliquée.
--
-- Sans effet si ces codes existent déjà (ex. si tu les as recréés toi-même
-- entre-temps depuis l'onglet 🎁 Offres).
-- ================================================================
insert into promotions (nom, categorie, code, type_remise, valeur, actif)
values
  ('Code historique — LOCAIR10', 'autre', 'LOCAIR10', 'montant_fixe', 10, true),
  ('Code historique — LOCA10',   'autre', 'LOCA10',   'montant_fixe', 10, true)
on conflict (upper(code)) where code is not null do nothing;
