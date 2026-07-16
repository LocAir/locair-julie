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

// Identité légale du vendeur — reprise telle quelle de mentions-legales.html
// et cgv.html, utilisée sur les contrats/factures PDF (module documents).
// À maintenir synchronisée si ces pages changent (raison sociale, SIRET...).
const SELLER = {
  raisonSociale: 'THIAM ALY',
  nomCommercial: "Loc'Air",
  formeJuridique: 'Entreprise individuelle (auto-entrepreneur)',
  siret: '853 730 562 00024',
  adresse: '11 Avenue Chantal, 06100 Nice, France',
  tel: '06 63 79 87 56',
  email: 'contact@locair.fr',
  // TVA non applicable — art. 293 B du CGI (franchise en base, cf. cgv.html §5).
  mentionTva: 'TVA non applicable — art. 293 B du CGI',
};

module.exports = { CGV_VERSION, ACCEPTANCE_TYPES, SELLER };
