// Tarif dégressif par palier — barème unique, utilisé partout où un nombre de
// jours doit être converti en prix (réservation, prolongation incrémentale,
// facturation de retard). Une seule implémentation : jusqu'ici recopiée à
// l'identique dans checkout.js, checkout-prolong.js, charge-retard.js et
// cron-daily.js, avec le risque qu'un correctif de tarif n'atteigne pas les 4.
// Durée minimale de location : 7 jours (le palier 3-6 jours n'existe plus).
function calcTieredPrice(days) {
  days = Math.max(1, days);
  if (days <= 7)  return days * 12;
  if (days <= 14) return 7 * 12 + (days - 7) * 10;
  if (days <= 21) return 7 * 12 + 7 * 10 + (days - 14) * 9;
  return 7 * 12 + 7 * 10 + 7 * 9 + (days - 21) * 8;
}

// Tarif journalier "plat" du palier auquel appartient un jour donné — utilisé
// pour le prélèvement automatique de retard (un montant par jour de retard,
// pas un cumul) : contrairement à calcTieredPrice(j) - calcTieredPrice(j-1),
// ça évite les montants aberrants aux frontières de palier (0 € ou négatif).
function dailyRate(day) {
  day = Math.max(1, day);
  if (day <= 7)  return 12;
  if (day <= 14) return 10;
  if (day <= 21) return 9;
  return 8;
}

module.exports = { calcTieredPrice, dailyRate };
