// Synchronise le statut du parc climatiseurs avec les actions terrain
// (Module 5, Partie 8) — un seul point d'écriture, jamais dupliqué.
async function setAppareilsStatutForReservation(supabase, reservationId, statut) {
  if (!reservationId) return;
  const { data: ras } = await supabase
    .from('reservation_appareils').select('appareil_id').eq('reservation_id', reservationId);
  const ids = (ras || []).map(r => r.appareil_id);
  if (!ids.length) return;
  await supabase.from('appareils').update({ statut }).in('id', ids);
}

// Contrôle d'état du matériel à la récupération -> statut résultant du parc.
const ETAT_MATERIEL_TO_APPAREIL_STATUT = {
  parfait_etat:           'disponible',
  usure_normale:          'disponible',
  nettoyage_necessaire:   'nettoyage',
  maintenance_necessaire: 'maintenance',
  hors_service:           'panne',
};

module.exports = { setAppareilsStatutForReservation, ETAT_MATERIEL_TO_APPAREIL_STATUT };
