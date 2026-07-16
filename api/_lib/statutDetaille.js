// Traduit la valeur interne de computeOrderStatus (_lib/orderStatus.js) vers
// le vocabulaire du Module 7, et réenregistre le résultat dans
// reservations.statut_detaille — une colonne d'AFFICHAGE en plus, jamais un
// remplacement de reservations.statut (qui continue seul de piloter
// paiement/remboursement/commissions, voir migration_2026-07-16_module7b).
//
// 'incident' n'est volontairement jamais produit ici : un incident est un
// signalement en parallèle du cycle de vie (déjà suivi par ailleurs, voir
// admin-alerts.js/incidents), pas une étape de progression de la commande —
// le masquer effacerait où en est réellement la commande à l'écran.
const MAP_VERS_STATUT_DETAILLE = {
  paiement_en_attente: 'nouvelle_demande',
  confirmee:           'confirmee',
  a_preparer:          'preparation',
  en_livraison:        'livraison_prevue',
  installee:           'en_location',
  en_location:         'en_location',
  a_recuperer:         'retour_prevu',
  terminee:            'terminee',
  annulee:             'annulee',
  remboursee:          'remboursee',
};

function toStatutDetaille(internalStatus) {
  return MAP_VERS_STATUT_DETAILLE[internalStatus] || null;
}

// Best-effort : ne doit jamais faire échouer l'appelant (affichage seulement).
async function syncStatutDetaille(supabase, reservationId, internalStatus) {
  const statutDetaille = toStatutDetaille(internalStatus);
  if (!statutDetaille || !reservationId) return;
  try {
    await supabase.from('reservations').update({ statut_detaille: statutDetaille }).eq('id', reservationId);
  } catch (_) { /* affichage seulement, pas bloquant */ }
}

module.exports = { MAP_VERS_STATUT_DETAILLE, toStatutDetaille, syncStatutDetaille };
