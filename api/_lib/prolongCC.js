// Prolongation d'une location Click & Collect — règles communes aux deux
// chemins de paiement d'une prolongation :
//   - api/checkout-prolong.js (formulaire « prolonger » du site)
//   - api/prolong-pay.js      (espace client et lien /prolongation)
//
// En Click & Collect, le client rapporte lui-même l'appareil au point où il
// l'a pris. Donc, pour prolonger :
//   1. le prix suit la même proportion que son prix de base (150 € les
//      7 jours, _lib/tarifDynamique.js) — jamais de prix majoré sur une
//      prolongation ;
//   2. le point doit être ouvert le jour du nouveau retour ;
//   3. le point doit avoir encore un appareil libre sur les jours ajoutés
//      (petit stock fixe par point) ;
//   4. la commission du commerçant suit le taux du point (commission_pct).
const { calcTieredPrice } = require('./pricing');
const { getPointRetrait, pointFermeLe } = require('./pointsRetrait');
const { occupationParPoint } = require('./clickCollect');
const { facteurCC } = require('./tarifDynamique');

function estClickCollect(resa) {
  return !!resa && resa.source_channel === 'click_collect';
}

// Montant « domicile » (barème classique, en centimes) → montant Click &
// Collect, arrondi à l'euro (comme le prix de base).
function montantProlongationCC(montantDomicileCents, pricing) {
  return Math.round(montantDomicileCents * facteurCC(calcTieredPrice, pricing) / 100) * 100;
}

// Vérifie qu'on peut prolonger et calcule prix + commission.
// orig   : réservation d'origine (ligne complète)
// debut  : début des jours ajoutés (= fin actuelle), AAAA-MM-JJ
// fin    : nouveau jour de retour, AAAA-MM-JJ
// qty    : nombre d'appareils
// montantDomicileCents : prix des jours ajoutés au barème classique
// → { ok: true, amountCents, commissionCents, point }
//   ou { ok: false, status, error } (message clair pour le client)
async function preparerProlongationCC(supabase, { orig, debut, fin, qty, montantDomicileCents, pricing }) {
  if (orig.rendu_at) {
    return { ok: false, status: 422, error: 'L’appareil a déjà été rendu au point de retrait : la location est terminée.' };
  }
  const amountCents = montantProlongationCC(montantDomicileCents, pricing);
  const point = getPointRetrait(orig.point_retrait_id || '');
  if (point) {
    if (pointFermeLe(point, fin)) {
      return { ok: false, status: 400, error: `Le point « ${point.nom} » est fermé ce jour-là : choisissez un autre jour de retour.` };
    }
    const occ = await occupationParPoint(supabase, [point], debut, fin);
    if ((occ[point.id] || 0) + (qty || 1) > (point.stock || 0)) {
      return { ok: false, status: 409, error: 'Plus d’appareil libre à votre point de retrait sur ces dates. Rapportez l’appareil à la date prévue, ou écrivez-nous pour trouver une solution.' };
    }
  }
  // Commission : seulement si la réservation est rattachée au commerçant
  // du point, au taux du point (15 % par défaut, _lib/pointsRetrait.js).
  const commissionCents = (orig.partenaire_id && point)
    ? Math.round(amountCents * (point.commission_pct || 0) / 100)
    : 0;
  return { ok: true, amountCents, commissionCents, point };
}

// Champs à recopier sur la ligne de prolongation pour qu'elle reste une
// location Click & Collect (pas de mission, pas de rappels à domicile).
function champsLigneCC(orig) {
  return { source_channel: 'click_collect', point_retrait_id: orig.point_retrait_id || null };
}

module.exports = { estClickCollect, montantProlongationCC, preparerProlongationCC, champsLigneCC };
