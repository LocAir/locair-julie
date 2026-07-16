// Codes promo personnalisés "PRENOM10/20/30" (ex. ERIK20 pour 20%) — chaque
// client reçoit à la fin de sa location un code basé sur son propre prénom,
// valable aussi pour un ami (avec le prénom de l'ami). Volontairement sans
// enregistrement en base : n'importe quel code de cette forme est accepté,
// tant que le prénom saisi sur la réservation en cours correspond au préfixe
// du code — décision explicite du propriétaire (pas de vérification a priori,
// même logique déjà en place pour les prolongations, voir prolong-pay.js).
const REFERRAL_PCT = 30;

function normalizePrenom(prenom) {
  return (prenom || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z]/g, '').toUpperCase();
}

function promoCodeForPrenom(prenom, pct) {
  return normalizePrenom(prenom) + (pct != null ? pct : REFERRAL_PCT);
}

// Renvoie le pourcentage (10/20/30) si promoCode correspond au prénom fourni, sinon 0.
function matchPromoPct(promoCode, prenom) {
  const code = (promoCode || '').trim().toUpperCase();
  const norm = normalizePrenom(prenom);
  if (!code || !norm || !code.startsWith(norm)) return 0;
  const suffix = parseInt(code.slice(norm.length), 10);
  return [10, 20, 30].includes(suffix) ? suffix : 0;
}

module.exports = { REFERRAL_PCT, normalizePrenom, promoCodeForPrenom, matchPromoPct };
