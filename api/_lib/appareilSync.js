const { recordMouvement, LOCALISATION_PAR_STATUT } = require('./stockMouvements');

// Synchronise le statut ET la localisation du parc climatiseurs avec les
// actions terrain (Module 5 Partie 8, Module 6 Partie 5) — journalise
// chaque changement via recordMouvement, jamais un simple écrasement.
async function setAppareilsStatutForReservation(supabase, reservationId, statut, {
  typeEvenement, livraisonId = null, utilisateur = null, commentaire = null,
} = {}) {
  if (!reservationId) return;
  const { data: ras } = await supabase
    .from('reservation_appareils').select('appareil_id').eq('reservation_id', reservationId);
  const ids = (ras || []).map(r => r.appareil_id);
  if (!ids.length) return;
  await Promise.all(ids.map(appareilId => recordMouvement(supabase, {
    appareilId, typeEvenement, nouveauStatut: statut,
    nouvelleLocalisation: LOCALISATION_PAR_STATUT[statut] || 'autre',
    livraisonId, reservationId, utilisateur, commentaire,
  })));
}

// Simple déplacement (localisation seule, statut inchangé) — ex. "départ
// entrepôt" quand le transporteur charge l'appareil dans son véhicule.
async function moveAppareilsForReservation(supabase, reservationId, nouvelleLocalisation, {
  typeEvenement, livraisonId = null, utilisateur = null, commentaire = null,
} = {}) {
  if (!reservationId) return;
  const { data: ras } = await supabase
    .from('reservation_appareils').select('appareil_id').eq('reservation_id', reservationId);
  const ids = (ras || []).map(r => r.appareil_id);
  if (!ids.length) return;
  await Promise.all(ids.map(appareilId => recordMouvement(supabase, {
    appareilId, typeEvenement, nouvelleLocalisation,
    livraisonId, reservationId, utilisateur, commentaire,
  })));
}

// Contrôle d'état du matériel à la récupération -> statut résultant du parc.
const ETAT_MATERIEL_TO_APPAREIL_STATUT = {
  parfait_etat:           'disponible',
  usure_normale:          'disponible',
  nettoyage_necessaire:   'nettoyage',
  maintenance_necessaire: 'maintenance',
  hors_service:           'panne',
};

module.exports = { setAppareilsStatutForReservation, moveAppareilsForReservation, ETAT_MATERIEL_TO_APPAREIL_STATUT };
