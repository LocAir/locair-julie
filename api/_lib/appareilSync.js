const { recordMouvement, LOCALISATION_PAR_STATUT } = require('./stockMouvements');

// Libère un appareil retiré d'une réservation (annulation, réduction de
// quantité, remplacement manuel) — retire toujours le lien reservation_appareils,
// mais ne remet "disponible" que si l'appareil n'a physiquement jamais quitté
// le dépôt (localisation 'stock_principal'). S'il est déjà chez le client ou
// dans un véhicule, le déclarer "disponible" ouvrirait la porte à une double
// réservation d'un appareil pas réellement récupérable tout de suite — un
// incident est créé à la place pour qu'un humain le récupère/le repasse
// disponible en connaissance de cause.
async function releaseAppareilFromReservation(supabase, { appareilId, reservationId, cityId, motif, utilisateur = 'systeme' }) {
  if (!appareilId) return { released: false };
  const { data: appareil } = await supabase
    .from('appareils').select('id, numero, statut, localisation').eq('id', appareilId).maybeSingle();
  if (!appareil) return { released: false };

  if (reservationId) {
    await supabase.from('reservation_appareils')
      .delete().eq('reservation_id', reservationId).eq('appareil_id', appareilId);
  }

  const jamaisSorti = !appareil.localisation || appareil.localisation === 'stock_principal';
  if (jamaisSorti) {
    if (appareil.statut !== 'disponible') {
      await recordMouvement(supabase, {
        appareilId, typeEvenement: 'autre', nouveauStatut: 'disponible',
        nouvelleLocalisation: 'stock_principal', reservationId, utilisateur, commentaire: motif,
      });
    }
    return { released: true };
  }

  await supabase.from('incidents').insert({
    city_id: cityId || null, type: 'autre', statut: 'nouveau',
    description: `Climatiseur n°${appareil.numero ?? appareilId} retiré de la réservation${reservationId ? ' #' + reservationId : ''} (${motif}) mais encore localisé "${appareil.localisation}" — à récupérer et repasser disponible manuellement.`,
  }).then(() => {}, () => {});
  return { released: false };
}

// Synchronise le statut ET la localisation du parc climatiseurs avec les
// actions terrain (Module 5 Partie 8, Module 6 Partie 5) — journalise
// chaque changement via recordMouvement, jamais un simple écrasement.
async function setAppareilsStatutForReservation(supabase, reservationId, statut, {
  typeEvenement, livraisonId = null, utilisateur = null, commentaire = null, nouvelleLocalisation = null,
} = {}) {
  if (!reservationId) return;
  const { data: ras } = await supabase
    .from('reservation_appareils').select('appareil_id').eq('reservation_id', reservationId);
  const ids = (ras || []).map(r => r.appareil_id);
  if (!ids.length) return;
  await Promise.all(ids.map(appareilId => recordMouvement(supabase, {
    appareilId, typeEvenement, nouveauStatut: statut,
    // Override explicite (ex. le transporteur garde l'appareil dans son
    // véhicule pour la prochaine livraison plutôt que de repasser par le
    // dépôt) — sinon la localisation standard associée au statut.
    nouvelleLocalisation: nouvelleLocalisation || LOCALISATION_PAR_STATUT[statut] || 'autre',
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

module.exports = { setAppareilsStatutForReservation, moveAppareilsForReservation, releaseAppareilFromReservation, ETAT_MATERIEL_TO_APPAREIL_STATUT };
