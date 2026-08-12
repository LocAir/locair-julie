// Bug trouvé le 2026-08-11 : new Date() n'importe quoi comme un jour hors
// calendrier (ex. "2026-02-30", "2026-04-31", "2026-02-29" une année non
// bissextile) — au lieu de rejeter, JS fait juste "avancer" au jour suivant
// valide (30 fév → 2 mars). Le seul test de NaN ci-dessus laissait donc
// passer ces dates comme "valides", avec le risque qu'une date invalide se
// glisse dans un paiement (checkout.js/checkout-prolong.js) et décale
// silencieusement les dates et le prix facturé. Un <input type="date"> de
// navigateur ne produit jamais une telle date, mais isValidDate() est aussi
// le seul garde-fou côté serveur contre une requête directe à l'API. Le
// aller-retour ci-dessous revérifie que la date reconstruite correspond
// exactement à ce qui a été saisi — sinon, c'est qu'elle a été "corrigée"
// en silence, donc invalide.
function isValidDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str || '')) return false;
  const d = new Date(str + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === str;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Intl.DateTimeFormat avec timeZone 'Europe/Paris' gère automatiquement
// l'heure d'été/hiver — pas besoin de calculer l'offset à la main.
function dateInParis(d) {
  const date = d instanceof Date ? d : new Date(d);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function todayParis() {
  return dateInParis(new Date());
}

module.exports = { isValidDate, addDays, todayParis, dateInParis };
