-- Click & Collect : pièce d'identité du client (carte recto/verso ou passeport).
-- Chemins des fichiers dans le bucket privé "missions" (préfixe identites/),
-- jamais d'URL publique. Lus par l'admin via des liens signés d'une heure
-- (admin-reservations.js, action identite_urls), supprimés 30 jours après la
-- fin de la location (cron-daily.js).
--
-- Le code est déjà en ligne avant cette migration : sans la colonne, la
-- réservation s'enregistre quand même et les chemins partent dans
-- instructions_acces. À coller dans Supabase → SQL Editor.
alter table reservations add column if not exists piece_identite_paths text[];
