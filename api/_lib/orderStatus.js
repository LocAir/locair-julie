// Statut "commande" affiché à l'admin — dérivé en lecture seule de
// reservations.statut + de l'état des missions livraison/récupération
// associées (livraisons.statut/type). N'écrit jamais rien : ni
// reservations.statut ni livraisons.statut ne gagnent de nouvelle valeur, le
// moteur transporteur/admin existant reste intact. Ne fait que combiner deux
// champs déjà en base pour donner une vue unifiée du cycle de vie complet.
const ORDER_STATUS_LABELS = {
  paiement_en_attente: 'Paiement en attente',
  confirmee:           'Confirmée',
  a_preparer:          'À préparer',
  en_livraison:        'En livraison',
  installee:           'Installée',
  en_location:         'En location',
  a_recuperer:         'À récupérer',
  terminee:            'Terminée',
  annulee:             'Annulée',
  remboursee:          'Remboursée',
  incident:            'Incident',
};

// `livraisons` : les lignes livraison/récupération de CETTE réservation
// (peut être vide si pas encore créées, ex. réservation manuelle non confirmée).
// `incidentOuvert` : au moins un incident non résolu lié à cette réservation.
function computeOrderStatus(reservation, livraisons = [], incidentOuvert = false) {
  if (reservation.statut === 'en_attente') return 'paiement_en_attente';
  if (reservation.statut === 'annulee')    return 'annulee';
  if (reservation.statut === 'remboursee') return 'remboursee';
  if (reservation.statut === 'terminee')   return 'terminee';

  // statut === 'confirmee' à partir d'ici : on regarde le détail des missions.
  if (incidentOuvert) return 'incident';

  const livraison    = livraisons.find(l => l.type === 'livraison');
  const recuperation = livraisons.find(l => l.type === 'recuperation');

  if (!livraison) return 'confirmee'; // missions pas encore créées

  if (['a_faire', 'acceptee'].includes(livraison.statut)) return 'a_preparer';
  if (['en_route', 'arrivee'].includes(livraison.statut)) return 'en_livraison';
  if (livraison.statut === 'probleme') return 'incident';

  // livraison.statut === 'fait' à partir d'ici : le client a l'appareil.
  if (!recuperation) return 'en_location';
  if (['a_faire', 'acceptee'].includes(recuperation.statut)) {
    // "Installée" juste après la pose (24h), puis "En location" le reste du séjour —
    // heuristique d'affichage, aucune donnée dédiée n'existe pour ce distinguo.
    const installedRecently = livraison.fait_at
      && (Date.now() - new Date(livraison.fait_at).getTime()) < 24 * 3600 * 1000;
    return installedRecently ? 'installee' : 'en_location';
  }
  if (['en_route', 'arrivee'].includes(recuperation.statut)) return 'a_recuperer';
  if (recuperation.statut === 'probleme') return 'incident';
  return 'en_location';
}

module.exports = { ORDER_STATUS_LABELS, computeOrderStatus };
