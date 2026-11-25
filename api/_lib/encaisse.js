// Montant réellement encaissé d'une location, pour les écrans et relevés
// des partenaires. Après un remboursement partiel, la commission est
// recalculée sur ce qui reste (webhook.js) mais prix_total_cents garde le
// prix de départ : on retrouve alors l'encaissé à partir de la commission.
function encaisseCents(prixCents, commissionCents, pct) {
  const prix = Number(prixCents) || 0;
  const com = Number(commissionCents);
  // Commission 0 = pas de commerçant relié (pas un remboursement) : prix entier.
  if (!(pct > 0) || !Number.isFinite(com) || com <= 0) return prix;
  return com < Math.round(prix * pct / 100) - 1 ? Math.round(com * 100 / pct) : prix;
}
module.exports = { encaisseCents };
