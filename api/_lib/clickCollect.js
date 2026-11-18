// Click & Collect — stock par point, prix fort à 80 % d'occupation, code de
// remise (QR) — logique partagée par click-collect-prix.js (affichage),
// checkout-click-collect.js (paiement), partenaire-remise.js (scan du
// commerçant) et webhook.js (QR dans l'email).
//
// Modèle « stock figé » (plan opérationnel du propriétaire) : chaque point a
// un nombre fixe d'appareils pour la saison. Le prix fort s'applique quand
// 80 % des appareils de la ville (tous ses points) sont déjà réservés sur
// les dates demandées. Rien d'autre ne fait monter le prix.
const crypto = require('crypto');
const { calcTieredPrice } = require('./pricing');
const { pointsDuCluster } = require('./pointsRetrait');

const SEUIL_PRIX_FORT = 0.8;      // 80 % d'occupation
const MAJORATION_PCT  = 25;       // +25 % (décidé par le propriétaire le 18/11/2026)
const ATTENTE_MAX_MIN = 60;       // une réservation « en attente » de paiement bloque l'appareil 1 h

function chevauche(q, debut, fin) {
  // [date_debut, date_fin) recoupe [debut, fin)
  return q.lt('date_debut', fin).gt('date_fin', debut);
}

// Nombre d'appareils déjà pris à ces dates, point par point.
// Repère les réservations par point_retrait_id (après migration) ; avant
// la migration, par l'adresse « CLICK & COLLECT — <nom du point> — … ».
async function occupationParPoint(supabase, points, debut, fin) {
  const limiteAttente = new Date(Date.now() - ATTENTE_MAX_MIN * 60000).toISOString();
  const actives = (q) => q.or(`statut.eq.confirmee,and(statut.eq.en_attente,created_at.gt."${limiteAttente}")`);
  const res = {};
  points.forEach((p) => { res[p.id] = 0; });

  let q = supabase.from('reservations').select('point_retrait_id, quantite').in('point_retrait_id', points.map((p) => p.id));
  const { data, error } = await chevauche(actives(q), debut, fin);
  if (!error) {
    (data || []).forEach((r) => { res[r.point_retrait_id] = (res[r.point_retrait_id] || 0) + (r.quantite || 1); });
    return res;
  }
  // Colonne pas encore créée : repli sur l'adresse.
  for (const p of points) {
    const q2 = supabase.from('reservations').select('quantite').eq('source_channel', 'click_collect').ilike('adresse', `CLICK & COLLECT — ${p.nom} —%`);
    const { data: d2 } = await chevauche(actives(q2), debut, fin);
    res[p.id] = (d2 || []).reduce((s, r) => s + (r.quantite || 1), 0);
  }
  return res;
}

// Prix d'une location Click & Collect, avec la règle du prix fort.
// pricing : config du barème (pricing_config).
async function prixClickCollect(supabase, point, debut, jours, pricing) {
  const fin = addDaysISO(debut, jours);
  const cluster = pointsDuCluster(point);
  const occ = await occupationParPoint(supabase, cluster, debut, fin);
  const capacite = cluster.reduce((s, p) => s + (p.stock || 0), 0);
  const pris = cluster.reduce((s, p) => s + (occ[p.id] || 0), 0);
  const tauxOccupation = capacite ? pris / capacite : 0;
  const libresAuPoint = Math.max(0, (point.stock || 0) - (occ[point.id] || 0));

  const normalCents = Math.round(calcTieredPrice(jours, pricing) * 100);
  const majore = tauxOccupation >= SEUIL_PRIX_FORT;
  const totalCents = majore ? Math.round(normalCents * (100 + MAJORATION_PCT) / 100) : normalCents;
  return { fin, normalCents, totalCents, majore, majorationPct: majore ? MAJORATION_PCT : 0, libresAuPoint, tauxOccupation };
}

function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Code de remise : impossible à deviner sans le secret du serveur. Le QR
// du client contient l'id de la réservation + ce code ; le commerçant le
// scanne depuis son espace partenaire pour valider la remise.
function codeRemise(reservationId, ref) {
  const secret = process.env.TRANSPORTEUR_SECRET || '';
  return crypto.createHmac('sha256', secret).update(`remise:${reservationId}:${ref || ''}`).digest('hex').slice(0, 20);
}
function lienRemise(reservationId, ref) {
  return `https://www.locair.fr/partenaire?remise=${reservationId}.${codeRemise(reservationId, ref)}`;
}
function imageQrRemise(reservationId, ref, taille = 240) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${taille}x${taille}&margin=8&data=${encodeURIComponent(lienRemise(reservationId, ref))}`;
}

module.exports = { prixClickCollect, occupationParPoint, codeRemise, lienRemise, imageQrRemise, SEUIL_PRIX_FORT, MAJORATION_PCT };
