# Instructions du dépôt

## Style de communication

Toujours expliquer les choses simplement, comme si le propriétaire était un adolescent qui n'y connaît rien en technique. Pas de jargon, pas de termes complexes — des phrases courtes, concrètes, qui vont droit au but. Cette règle s'applique à toutes les réponses, synthèses et résumés, sur l'ensemble du projet Loc'Air (site, app admin, app transporteur).

## Déploiement

Quand une pull request de correctifs/améliorations est prête sur la branche de
travail (checks verts, pas de conflit), la merger vers `main` directement,
sans demander confirmation au préalable — le propriétaire a validé ce mode de
fonctionnement. `main` est la branche déployée en production (Vercel).

## Migrations SQL

Cette session n'a aucun accès à la base Supabase de production (pas
d'identifiants) — un changement de schéma (nouvelle colonne/table dans
`supabase/schema.sql` ou `supabase/migration_2026-07-09.sql`) ne prend jamais
effet tout seul en prod, même après merge et déploiement du code. Le code déjà
vécu ça en cassant Réservations/Livraisons (colonne `reservations.masquee`
utilisée par le code déployé mais absente de la vraie base).

Donc : avant de merger une PR qui touche au schéma, prévenir explicitement le
propriétaire et lui donner le SQL exact à coller dans Supabase → SQL Editor.
Ne jamais supposer que la migration a été appliquée juste parce que le code
est en prod.
