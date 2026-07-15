// Version des documents légaux présentés au client avant paiement (CGV,
// incluant les obligations d'utilisation article 9 — voir /cgv). À
// incrémenter manuellement (date du jour) à chaque changement substantiel du
// contenu de cgv.html, pour que les acceptations déjà enregistrées gardent
// une trace fidèle de la version réellement lue par le client à l'époque.
const CGV_VERSION = '2026-07-14';

// Types d'acceptation distincts trackés en base (table cgv_acceptations) —
// deux cases à cocher séparées côté client, deux lignes d'audit séparées.
const ACCEPTANCE_TYPES = {
  CGV_LOCATION:           'cgv_location',
  CONDITIONS_UTILISATION: 'conditions_utilisation',
};

module.exports = { CGV_VERSION, ACCEPTANCE_TYPES };
