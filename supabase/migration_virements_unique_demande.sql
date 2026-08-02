-- Empêche qu'un transporteur soumette deux demandes de virement simultanées
-- (race condition TOCTOU via double-tap). L'index partiel garantit qu'il ne
-- peut y avoir qu'une seule ligne avec statut='demande' par transporteur.
-- Le code (api/transporteur-earnings.js) attrape le code d'erreur 23505
-- (violation de contrainte unique) et renvoie 409 proprement.
create unique index if not exists virements_demande_unique_per_transporteur
  on virements (transporteur_id)
  where statut = 'demande';
