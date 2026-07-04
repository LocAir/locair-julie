# Mise en route de l'application interne Loc'Air

## 1. Créer le projet Supabase

1. Sur [supabase.com](https://supabase.com), créer un projet (gratuit pour démarrer).
2. Dans l'éditeur SQL du projet, exécuter le contenu de `supabase/schema.sql`.
3. Vérifier/ajuster la ligne `insert into cities (...)` à la fin du script avec le vrai nombre de climatiseurs disponibles.

## 2. Variables d'environnement (Vercel → Settings → Environment Variables)

| Variable | Où la trouver |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role key (secret, jamais côté navigateur) |
| `ADMIN_PASSWORD` | À choisir — mot de passe de l'espace `/admin` (toi uniquement) |
| `TRANSPORTEUR_SECRET` | À choisir — chaîne aléatoire longue (ex. générée par un gestionnaire de mots de passe). Sert uniquement à signer les sessions transporteur, jamais saisie par personne. |
| `CITY_SLUG` | `nice` par défaut — à changer uniquement pour un futur déploiement d'une autre ville |

Les variables existantes (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `OPERATOR_TOKEN`, `BREVO_API_KEY`) ne changent pas.

## 3. Ajouter les transporteurs

Dans `/admin` → onglet **Transporteurs**, ajouter chaque transporteur avec son nom, son téléphone, son **email** et sa rémunération par mission (livraison / récupération). Un **code personnel à 6 chiffres** est généré automatiquement — communique-le au transporteur concerné pour qu'il se connecte sur `/transporteur`. Les tentatives de connexion (admin comme transporteur) sont limitées à 10 essais / 15 minutes par adresse IP pour empêcher un balayage automatique du code.

Renseigner l'email de chaque transporteur n'est pas obligatoire, mais c'est ce qui lui permet d'utiliser "Code oublié ?" sur `/transporteur` sans avoir à te contacter — un nouveau code est alors généré et envoyé par email, et l'ancien cesse immédiatement de fonctionner (y compris sur un téléphone déjà connecté avec l'ancien code). Le bouton "Changer le code" dans l'admin fait la même chose manuellement (utile par exemple quand un transporteur quitte l'équipe) et déconnecte lui aussi tous ses appareils. Désactiver un transporteur (bouton "Désactiver") coupe également son accès immédiatement.

## 4. Vérifications avant mise en production

- `/admin` : mauvais mot de passe rejeté, bon mot de passe accepté, chiffres cohérents avec Stripe.
- `/transporteur` : mauvais code rejeté ; un transporteur ne doit voir que ses propres missions et gains, jamais ceux d'un collègue.
- "Code oublié ?" : demander un reset avec l'email d'un transporteur actif → un email avec un nouveau code arrive ; vérifier que l'ancien code ne fonctionne plus.
- Désactiver un transporteur puis réessayer de se connecter avec son ancien code (ou depuis un appareil déjà connecté) → doit être rejeté.
- Faire une réservation test en mode Stripe test avec le stock à 0 → le site doit bloquer avant le paiement.
- Faire une réservation test avec stock disponible → vérifier qu'une ligne apparaît dans **Réservations**, puis que les 2 missions (livraison + récupération) apparaissent dans **Livraisons** après confirmation du paiement.
- Assigner la mission à un transporteur dans `/admin` → vérifier qu'elle apparaît dans `/transporteur` pour lui.
- Dérouler une mission complète (Accepter → photo dépôt → Arrivé → vidéo installation → Livraison OK) et vérifier que le gain apparaît dans "Mon activité".
- Vérifier que `retard.html` fonctionne toujours à l'identique (aucune régression).
- Suivi en direct : depuis `/transporteur`, accepter une mission puis autoriser la géolocalisation quand le navigateur le demande → dans `/admin` → Livraisons, le bouton "🔴 Suivre en direct" doit faire apparaître une carte avec la position qui bouge.

## Suivi en direct du livreur (carte)

Pendant qu'une mission est acceptée ou en cours (`acceptee`/`arrivee`), le téléphone du transporteur envoie sa position toutes les ~10-15 secondes (avec son accord — un bandeau "Ta position est partagée avec Aly" s'affiche pendant ce temps). Dans `/admin` → Livraisons, le bouton "🔴 Suivre en direct" ouvre une carte (OpenStreetMap, gratuite, sans clé API) avec la position du livreur, l'adresse du client, et une estimation d'arrivée.

Limites assumées pour cette v1 :
- Le trajet affiché est une ligne droite, pas un itinéraire qui suit les rues.
- L'ETA est une estimation à vitesse moyenne (pas de trafic réel).
- Ça nécessite que le livreur garde l'onglet `/transporteur` ouvert et ait accepté la géolocalisation — s'il ferme l'appli, la position s'arrête de se mettre à jour (affiché comme "signal perdu" après 90s).
- Passer à un itinéraire routier réel (comme Uber/Deliveroo) plus tard demande une clé API Google Maps ou Mapbox — pas urgent, à activer si besoin.
- Pas encore de vue client — l'architecture (position stockée par transporteur, indépendante de l'admin) permet de l'ajouter plus tard sans tout refaire.

## Limites connues (volontairement simples pour l'instant)

- Le taux d'occupation affiché est une photo instantanée (aujourd'hui), pas une moyenne sur la période.
- Une prolongation crée une réservation séparée ; l'ancienne date de récupération est automatiquement annulée dans les missions terrain, mais l'historique reste sous deux lignes distinctes.
- Le virement bancaire réel reste manuel (fait par toi) — l'application ne fait que suivre les montants dus et les demandes, elle ne transfère pas d'argent automatiquement.
- Le bouton "Appeler le client" (tel:) est déjà en place dans `/transporteur`. Le SMS automatique au client ("votre livreur est en bas") via Brevo est prévu mais volontairement pas encore branché — à activer plus tard quand Brevo SMS sera configuré.
