-- Aperçu fidèle des communications déjà envoyées (fiche client admin,
-- panneau Communications) : sauvegarde le contenu réel de chaque
-- email/SMS au moment de l'envoi. Voir CLAUDE.md : à coller dans
-- Supabase → SQL Editor, confirmer avant de merger la PR correspondante.

alter table email_log add column if not exists contenu text;
