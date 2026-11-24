// Prolongation d'une location Click & Collect — règles communes aux deux
// chemins de paiement d'une prolongation :
//   - api/checkout-prolong.js (formulaire « prolonger » du site)
//   - api/prolong-pay.js      (espace client et lien /prolongation)
//
// En Click & Collect, le client rapporte lui-même l'appareil au point où il
// l'a pris. Donc, pour prolonger :
//   1. le prix des jours ajoutés = prix de la nouvelle durée − prix de la
//      durée actuelle (99 € les 3 jours, 150 € les 7 jours,
//      _lib/tarifDynamique.js) — jamais de prix majoré sur une prolongation ;
//   2. le point doit être ouvert le jour du nouveau retour ;
//   3. le point doit avoir encore un appareil libre sur les jours ajoutés
//      (petit stock fixe par point) ;
//   4. la commission du commerçant suit le taux du point (commission_pct).
const { calcTieredPrice } = require('./pricing');
const { getPointRetrait, pointFermeLe } = require('./pointsRetrait');
const { occupationParPoint, numeroComptoir, JOURS_MAX_CC } = require('./clickCollect');
const { facteurCC, baseCents } = require('./tarifDynamique');

function estClickCollect(resa) {
  return !!resa && resa.source_channel === 'click_collect';
}

// Montant « domicile » (barème classique, en centimes) → montant Click &
// Collect, arrondi à l'euro (comme le prix de base).
function montantProlongationCC(montantDomicileCents, pricing) {
  return Math.round(montantDomicileCents * facteurCC(calcTieredPrice, pricing) / 100) * 100;
}

// Prix des jours ajoutés, en centimes, avant la réduction du départ :
// prix Click & Collect de la nouvelle durée totale − prix de la durée
// actuelle (voir tarifDynamique.bornes). Ainsi, 3 jours prolongés à 7 ne
// coûtent jamais plus que 7 jours réservés d'un coup. Repli : barème × facteur.
function prixJoursAjoutesCC(orig, debut, fin, qty, montantDomicileCents, pricing) {
  const avant = jours(orig.date_debut, debut), apres = jours(orig.date_debut, fin);
  const delta = (apres > avant && avant >= 1) ? baseCents(apres, calcTieredPrice, pricing) - baseCents(avant, calcTieredPrice, pricing) : 0;
  return delta > 0 ? delta * Math.max(1, qty || 1) : montantProlongationCC(montantDomicileCents, pricing);
}

// Prix de prolongation (décision du propriétaire, 21/11/2026) : on garde
// le barème dégressif, et un client qui avait payé MOINS que le prix normal
// (tarif dynamique « période calme ») garde sa réduction. Jamais plus cher
// que le prix normal : un prix monté au départ ne majore pas la prolongation.
// → coefficient entre 0 et 1 appliqué au prix Click & Collect de la prolongation.
function jours(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }
async function coefPrixPaye(supabase, orig, pricing) {
  try {
    const qty = Math.max(1, orig.quantite || 1);
    // durée de la réservation de départ = durée actuelle − jours déjà prolongés
    let prolonges = 0;
    const { data: lignes } = await supabase.from('reservations').select('date_debut, date_fin')
      .eq('reservation_origine_id', orig.id).eq('statut', 'confirmee');
    (lignes || []).forEach((l) => { prolonges += Math.max(0, jours(l.date_debut, l.date_fin)); });
    const joursInit = jours(orig.date_debut, orig.date_fin) - prolonges;
    if (joursInit < 1) return 1;
    const normal = baseCents(joursInit, calcTieredPrice, pricing);
    const paye = (orig.prix_total_cents || 0) / qty;
    if (!normal || !paye) return 1;
    return Math.min(1, paye / normal);
  } catch (e) { return 1; }
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
  // Même limite qu'à la réservation : 90 jours de location au total.
  if (jours(orig.date_debut, fin) > JOURS_MAX_CC) {
    return { ok: false, status: 400, error: `Une location Click & Collect dure ${JOURS_MAX_CC} jours au plus. Pour plus long, écrivez-nous.` };
  }
  const coef = await coefPrixPaye(supabase, orig, pricing);
  const amountCents = Math.round(prixJoursAjoutesCC(orig, debut, fin, qty, montantDomicileCents, pricing) * coef / 100) * 100;
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
  // du point, au taux du point (20 % par défaut, _lib/pointsRetrait.js).
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

// Numéro Click & Collect à 4 chiffres tapé par le client (au lieu de la
// référence CC-…) → vraie référence, retrouvée avec son email.
async function refDepuisNumero(supabase, email, saisie) {
  const s = String(saisie || '').trim();
  if (!/^\d{4}$/.test(s) || !email) return saisie;
  const { data } = await supabase.from('reservations').select('ref')
    .ilike('email', String(email).trim().toLowerCase()).eq('source_channel', 'click_collect')
    .is('reservation_origine_id', null).eq('statut', 'confirmee').order('id', { ascending: false }).limit(50);
  const r = (data || []).find((x) => numeroComptoir(x.ref) === s);
  return r ? r.ref : saisie;
}

module.exports = { prixJoursAjoutesCC, refDepuisNumero, estClickCollect, montantProlongationCC, preparerProlongationCC, champsLigneCC, coefPrixPaye };
