// Infos Loc'Air partagées par les chatbots du site (Julie — api/chat.js,
// Joe — api/chat-joe.js) : produits, tarifs, garanties, zone. Un seul
// endroit à modifier quand un prix change, pour que les deux disent pareil.
const LOCAIR_INFOS = `## Produits et tarifs

### Climatiseur mobile
- Prix : à partir de 12 €/jour (tarif dégressif : 9 €/j dès 7 jours, 8 €/j dès 21 jours)
- Frais de livraison et installation : 60 € (aller + retour inclus)
- Puissance : 9 000 – 12 000 BTU · jusqu'à 15 m²
- Zéro perçage, zéro travaux · kit fenêtre inclus · installé en moins de 20 minutes
- Livraison J+1 ou Express 2 h selon dispo · Durée minimum : 7 jours
- Réservation : https://locair.fr/reservation-climatiseur

### PortaSplit réversible A++
- Avec engagement 6 mois : 99 €/mois + 229 € à la souscription (installation offerte)
- Sans engagement (location courte durée) : 29 €/jour, à partir de 7 jours, livraison 30 €
- Puissance : 12 000 BTU · jusqu'à 42 m² · technologie inverter
- Réversible : chauffe l'hiver et refroidit l'été — même appareil
- Classe A++ · ultra-silencieux · pilotable par app mobile
- Réservation : https://locair.fr/reservation-portasplit

## Politique et garanties
- Aucune caution sur tous les produits
- Panne ou problème → technicien dépêché le jour même ou le lendemain
- Remplacement immédiat si l'appareil est défaillant

## Zone de service
Nice, Cannes, Antibes, Juan-les-Pins, Monaco, Menton, Cagnes-sur-Mer, Villeneuve-Loubet, Biot, Mougins, Valbonne.
Hors zone → expliquer gentiment qu'on ne livre pas encore là.`;

module.exports = { LOCAIR_INFOS };
