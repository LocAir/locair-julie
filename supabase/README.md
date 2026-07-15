# Mise en route de l'application interne Loc'Air

## 1. Créer le projet Supabase

1. Sur [supabase.com](https://supabase.com), créer un projet (gratuit pour démarrer).
2. Dans l'éditeur SQL du projet, exécuter le contenu de `supabase/schema.sql`.
3. Vérifier/ajuster la ligne `insert into appareils (...)` à la fin du script avec le vrai nombre de climatiseurs à créer (numérotés automatiquement 1, 2, 3…). Tu pourras en ajouter d'autres plus tard directement depuis `/admin` → Stock.

## 2. Variables d'environnement (Vercel → Settings → Environment Variables)

| Variable | Où la trouver |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role key (secret, jamais côté navigateur) |
| `ADMIN_PASSWORD` | À choisir — mot de passe de l'espace `/admin` (toi uniquement) |
| `TRANSPORTEUR_SECRET` | À choisir — chaîne aléatoire longue (ex. générée par un gestionnaire de mots de passe). Sert uniquement à signer les sessions transporteur, jamais saisie par personne. |
| `CITY_SLUG` | `nice` par défaut — à changer uniquement pour un futur déploiement d'une autre ville |
| `VAPID_PUBLIC_KEY` | `BENuS69HM9nkUvhQmdBAO0H53GUiaJOZDM6sfMMh939W6rVdsTXpZRfflPK5YjeaGFAWYqmTiL4tPSw_pwC4tRI` (déjà généré, à copier tel quel) |
| `VAPID_PRIVATE_KEY` | `DPJk3QuSOSPyRVsDnp4zAVbMKJySo97XaHQKhhxwvQs` (déjà généré, à copier tel quel — secret, jamais côté navigateur) |
| `VAPID_SUBJECT` | `mailto:contact@locair.fr` (optionnel — c'est déjà la valeur par défaut si absent) |

Les variables existantes (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `OPERATOR_TOKEN`, `BREVO_API_KEY`) ne changent pas.

Les clés VAPID ci-dessus servent uniquement à signer les notifications push envoyées au transporteur (nouvelles missions, annulations) — elles ne sont liées à aucun compte externe, tu peux les utiliser telles quelles. Si tu préfères en générer de nouvelles toi-même : `npx web-push generate-vapid-keys`.

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
- Notifications push : se connecter sur `/transporteur` et accepter la demande de notification du navigateur → assigner une mission à ce transporteur depuis `/admin` → une notification doit apparaître sur son téléphone même si l'onglet/l'app est fermé.
- Partenaires : créer un partenaire de test dans `/admin` → Partenaires, ouvrir `www.locair.fr/?p=SONCODE` puis faire une réservation test → vérifier qu'elle apparaît avec la bonne commission dans `/admin` → Partenaires → Revenus, et dans `/partenaire` une fois connecté avec le code personnel du partenaire.
- Face ID / empreinte : se connecter avec le code une première fois → accepter "Activer" sur la carte proposée → se déconnecter ("changer") → le bouton "🔓 Face ID / empreinte" doit permettre de se reconnecter sans ressaisir le code. Changer le code de ce transporteur depuis `/admin` doit ensuite désactiver cet accès (il doit revalider avec le nouveau code puis réactiver Face ID).

### Module 1 — Réservation et paiement (2026-07-14)

- Le bouton "Procéder au paiement" reste désactivé tant que les 3 cases (CGV/CGL, conditions d'utilisation du climatiseur, autorisation de prélèvement retard) ne sont pas toutes cochées.
- Un appel direct à `/api/checkout` sans `cgv_accepted: true` **et** `conditions_utilisation_accepted: true` doit être rejeté (400), même si le montant et les dates sont valides — la validation ne doit jamais reposer uniquement sur le bouton désactivé côté site.
- Après une réservation payée, vérifier dans Supabase → table `cgv_acceptations` que 2 lignes existent pour cette réservation (`cgv_location` et `conditions_utilisation`), avec un `accepted_at` cohérent.
- Prolongation (`/#prolong`) : refaire un test complet de bout en bout (la prolongation était cassée — un bug de portée de variable faisait échouer *tous* les paiements de prolongation en 500 avant ce correctif). Un appel direct à `/api/checkout-prolong` sans `cgv_accepted: true` doit être rejeté (400).
- Simuler dans Stripe (mode test) un paiement refusé (`payment_intent.payment_failed`) → un incident doit apparaître dans `/admin` → Incidents, et une notification push doit arriver côté admin.
- Simuler un remboursement Stripe (`charge.refunded`) sur une réservation confirmée → son statut doit passer à "remboursée" et un incident + une notification admin doivent être créés.
- Dans `/admin` → Réservations, l'API renvoie désormais un champ `statut_commande` calculé (paiement en attente / confirmée / à préparer / en livraison / installée / en location / à récupérer / terminée / annulée / remboursée / incident) à partir du statut de la réservation et de ses missions — pas encore affiché dans l'interface (`admin/index.html`), à faire dans un module suivant si utile visuellement.

### Module 2 — Documents automatiques : contrat + facture PDF (2026-07-15)

- Faire une réservation test payée (Stripe mode test) → dans Supabase → table `documents`, 2 lignes doivent apparaître pour cette réservation (`type = 'contrat'` et `type = 'facture'`), statut `envoye` si le client a un email.
- Le client doit recevoir **un seul email** avec les 2 PDF en pièce jointe (contrat + facture) en plus des emails de confirmation existants.
- Ouvrir le PDF du contrat reçu : vérifier identité client, numéro de commande, dates, climatiseur assigné (ou "Attribué à la livraison" si pas encore assigné), montant, et les 2 acceptations CGV/conditions avec horodatage + version.
- Ouvrir le PDF de la facture reçue : vérifier numéro de facture (`FACT-2026-NNNNNN`), numéro de commande, montant payé, mention TVA non applicable (art. 293 B).
- Rejouer le même événement webhook Stripe (redélivrance) → vérifier qu'aucune nouvelle ligne `documents` n'apparaît et qu'aucun second email n'est envoyé (idempotence — la facture ne doit **jamais** être dupliquée).
- Cliquer sur "Consulter le contrat en ligne" / "Consulter la facture en ligne" depuis l'email → le document s'ouvre, et son statut passe à `consulte` dans Supabase (avec `consulte_at` renseigné).
- Faire 2 réservations payées presque simultanément → vérifier dans `facture_compteur` que les 2 numéros de facture générés sont bien consécutifs, sans doublon ni trou.
- Un lien `/api/document-view?token=...` avec un token invalide/inexistant doit renvoyer une erreur claire, jamais un chemin de fichier ou une donnée interne.

## Notifications push (nouvelles missions, annulations)

Un transporteur reçoit une notification sur son téléphone — même app fermée — dans deux cas : une mission lui est assignée (première fois ou réassignation), ou une récupération qu'on lui avait confiée est annulée parce que le client a prolongé sa location. Il touche la notification pour ouvrir directement l'app.

Ça ne marche qu'une fois que le transporteur a accepté la demande d'autorisation du navigateur (affichée automatiquement à sa connexion sur `/transporteur`). S'il l'a refusée par erreur, il doit réinitialiser les autorisations de notification du site dans les réglages de son navigateur puis se reconnecter. Aucune configuration de ton côté au-delà des variables `VAPID_*` ci-dessus.

## Connexion par Face ID / empreinte (WebAuthn)

Le code à 6 chiffres reste toujours disponible — Face ID/empreinte est une option en plus, pas un remplacement. À sa connexion, un transporteur dont l'appareil a un capteur biométrique voit une carte "Active Face ID / empreinte" ; s'il accepte, son navigateur (Face ID sur iPhone, empreinte/reconnaissance faciale sur Android) est enregistré. Aux connexions suivantes, un bouton "🔓 Face ID / empreinte" apparaît au-dessus du champ code et le connecte directement, sans rien taper.

Gratuit et standard (WebAuthn, le même mécanisme que les grandes apps bancaires utilisent côté web) — rien à configurer côté toi, aucun compte tiers. Changer le code d'un transporteur (depuis `/admin` ou via "Code oublié ?") révoque automatiquement son accès Face ID par sécurité ; il devra le réactiver après s'être reconnecté avec le nouveau code.

## Stock par appareil numéroté

Chaque climatiseur a un numéro (une étiquette à coller dessus). Dans `/admin` → Stock :
- **+ Ajouter un appareil** : à chaque nouvel achat, un clic — le prochain numéro est attribué automatiquement.
- Chaque appareil a un statut : **Disponible**, **En panne** ou **Maintenance**. Un appareil en panne/maintenance ne compte plus dans la disponibilité tant qu'il n'est pas repassé en disponible.
- Il n'y a pas de statut "loué" à gérer à la main : dès qu'une réservation est payée, l'appli assigne automatiquement le prochain numéro libre à cette réservation (visible dans **Livraisons** et sur la mission du transporteur, ex. "Unité n°3"). Le livreur voit directement quelle unité récupérer au dépôt, avec le bon kit de calfeutrage selon le type de fenêtre du client.
- Pour une prolongation, l'appli réattribue automatiquement le même appareil que la réservation d'origine (le client garde physiquement le même climatiseur).

## Espace partenaire (conciergeries, apporteurs d'affaires)

Une conciergerie (ou toute entreprise) qui t'apporte des clients touche une commission (10% par défaut, réglable par partenaire) sur chaque réservation faite depuis son lien.

Dans `/admin` → onglet **Partenaires**, ajouter chaque partenaire (nom, contact, commission). Deux codes sont générés automatiquement :
- **Le lien d'affiliation** (ex. `locair.fr/?p=azur12`) — à donner au partenaire pour qu'il le mette sur son propre site. Un client qui clique dessus puis réserve est automatiquement rattaché à ce partenaire.
- **Le code personnel à 6 chiffres** — à communiquer au partenaire pour qu'il se connecte sur `/partenaire` et suive ses gains au jour le jour.

Sur `/partenaire`, le partenaire voit : son lien à copier, ses gains du jour et du mois, l'historique des réservations qu'il a apportées, et un bouton pour demander un virement (comme les transporteurs). Le virement réel reste manuel — l'appli suit juste les montants dus et les demandes, elle ne transfère pas d'argent automatiquement. Aucune variable d'environnement supplémentaire n'est nécessaire (réutilise `TRANSPORTEUR_SECRET`, déjà configuré).

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
