// Tarif dégressif par palier — barème unique, utilisé partout où un nombre de
// jours doit être converti en prix (réservation, prolongation incrémentale,
// facturation de retard). Une seule implémentation : jusqu'ici recopiée à
// l'identique dans checkout.js, checkout-prolong.js, charge-retard.js et
// cron-daily.js, avec le risque qu'un correctif de tarif n'atteigne pas les 4.
function calcTieredPrice(days) {
  days = Math.max(1, days);
  if (days <= 7)  return days * 20;
  if (days <= 14) return 7 * 20 + (days - 7) * 18;
  if (days <= 21) return 7 * 20 + 7 * 18 + (days - 14) * 17;
  return 7 * 20 + 7 * 18 + 7 * 17 + (days - 21) * 16;
}

module.exports = { calcTieredPrice };
