// Traduit le statut interne (_lib/orderStatus.js, déjà utilisé par l'admin)
// en progression grand public à 7 étapes + message "prochaine étape" — sans
// jamais dupliquer la logique de calcul du statut lui-même, seulement sa
// présentation. Les statuts techniques internes (a_faire/acceptee/arrivee,
// webhook, etc.) ne sortent jamais de cette fonction.
const { computeOrderStatus } = require('./orderStatus');

const STAGE_LABELS = {
  1: 'Réservation confirmée',
  2: 'Préparation de votre livraison',
  3: 'Livraison programmée',
  4: 'Installation réalisée',
  5: 'Location en cours',
  6: 'Retour programmé',
  7: 'Location terminée',
};

const INTERNAL_TO_STAGE = {
  confirmee:    1,
  a_preparer:   2,
  en_livraison: 3,
  installee:    4,
  en_location:  5,
  a_recuperer:  6,
  terminee:     7,
};

const NEXT_STEP_MESSAGE = {
  paiement_en_attente: 'Votre paiement est en cours de confirmation.',
  confirmee:    'Votre climatiseur sera livré prochainement.',
  a_preparer:   'Votre climatiseur sera livré prochainement.',
  en_livraison: 'Votre livraison est programmée.',
  installee:    'Votre climatiseur est installé. Vous pouvez commencer votre location.',
  en_location:  "Profitez de votre climatiseur ! Le centre d'aide répond aux questions les plus fréquentes.",
  a_recuperer:  'Votre récupération est prévue prochainement.',
  terminee:     "Merci d'avoir choisi Loc'Air !",
};

// Remplace la progression numérotée par un message ponctuel pour les statuts
// qui ne représentent pas une étape du cycle de vie normal.
const BANNER_MESSAGE = {
  annulee:    'Cette réservation a été annulée.',
  remboursee: 'Cette réservation a été remboursée.',
  incident:   'Un point est en cours de traitement sur votre dossier — notre équipe vous contactera si besoin.',
};

// Ne renvoie JAMAIS `internal` au client — uniquement pour usage serveur
// (logs, tests). L'appelant (api/client-dashboard.js) ne doit pas le
// transmettre tel quel dans la réponse JSON.
function computeClientProgress(reservation, livraisons = [], incidentOuvert = false) {
  const internal = computeOrderStatus(reservation, livraisons, incidentOuvert);

  if (BANNER_MESSAGE[internal]) {
    return { stage: null, stageLabel: null, banner: BANNER_MESSAGE[internal], nextStep: null, internal };
  }
  if (internal === 'paiement_en_attente') {
    return { stage: 0, stageLabel: 'Paiement en attente', banner: null, nextStep: NEXT_STEP_MESSAGE.paiement_en_attente, internal };
  }

  const stage = INTERNAL_TO_STAGE[internal] || 1;
  return { stage, stageLabel: STAGE_LABELS[stage], banner: null, nextStep: NEXT_STEP_MESSAGE[internal], internal };
}

module.exports = { STAGE_LABELS, computeClientProgress };
