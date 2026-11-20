// Click & Collect — stock par point, prix fort à 80 % d'occupation, code de
// remise (QR) — logique partagée par click-collect-prix.js (affichage),
// checkout-click-collect.js (paiement), partenaire-remise.js (scan du
// commerçant) et webhook.js (QR dans l'email).
//
// Modèle « stock figé » (plan opérationnel du propriétaire) : chaque point a
// un nombre fixe d'appareils pour la saison. Le prix suit la tarification
// dynamique de _lib/tarifDynamique.js (stock de la ville, chaleur prévue,
// dernière minute, période calme), toujours entre 139 € et 189 € les 7 jours.
const crypto = require('crypto');
const { calcTieredPrice } = require('./pricing');
const { pointsDuCluster } = require('./pointsRetrait');
const { appliquer, baseCents } = require('./tarifDynamique');
const { todayParis } = require('./dates');

const SEUIL_PRIX_FORT = 0.8;      // 80 % d'occupation
const MAJORATION_PCT  = 25;       // +25 % (décidé par le propriétaire le 18/11/2026)
// Une réservation « en attente » de paiement bloque l'appareil 30 min —
// même durée que la fonction SQL available_units (supabase/schema.sql),
// pour que le stock du point et le stock de la ville disent la même chose.
// Un paiement qui arrive plus tard est revérifié par le webhook (alerte à
// l'admin si le point est alors complet).
const ATTENTE_MAX_MIN = 30;
// Durée d'une location Click & Collect : 7 à 90 jours (fixe, ne dépend pas
// du barème de la livraison). Retrait au plus tard dans 1 an.
const JOURS_MIN_CC = 7, JOURS_MAX_CC = 90, AVANCE_MAX_JOURS = 365;

function chevauche(q, debut, fin) {
  // [date_debut, date_fin) recoupe [debut, fin)
  return q.lt('date_debut', fin).gt('date_fin', debut);
}

// Colonne point_retrait_id absente (migration du 18/11 pas encore passée) ?
// Seul cas où l'on se replie sur l'adresse ; toute autre erreur remonte.
function colonnePointAbsente(error) {
  const m = String((error && (error.message || error.details)) || '');
  return /point_retrait_id/.test(m) && (/does not exist|n'existe pas|schema cache|Could not find/i.test(m) || error.code === '42703' || error.code === 'PGRST204');
}

// Une ligne compte-t-elle dans l'occupation ?
//  - réservation confirmée : oui, sauf une PROLONGATION confirmée (le
//    webhook a déjà repoussé la date de fin de la réservation d'origine :
//    la compter en plus prendrait l'appareil deux fois) ;
//  - en attente de paiement depuis moins de 30 min : seulement si
//    avecAttente (contrôle du stock avant paiement). Pour le PRIX, on ne
//    compte que le confirmé : quelqu'un qui ouvre puis abandonne le
//    paiement ne doit pas faire monter le prix des autres.
function compte(r, limiteAttente, avecAttente) {
  if (r.statut === 'confirmee') return r.source !== 'site_prolongation';
  if (r.statut === 'en_attente') return avecAttente && (!r.created_at || r.created_at > limiteAttente);
  return false;
}

// Nombre d'appareils déjà pris à ces dates, point par point.
// Repère les réservations par point_retrait_id (après migration) ; avant
// la migration, par l'adresse « CLICK & COLLECT — <nom du point> — … ».
// options.avecAttente (true par défaut) : compter aussi les paiements en
// cours (moins de 30 min). false = seulement le confirmé (signal de prix).
async function occupationParPoint(supabase, points, debut, fin, options = {}) {
  const avecAttente = options.avecAttente !== false;
  const limiteAttente = new Date(Date.now() - ATTENTE_MAX_MIN * 60000).toISOString();
  const res = {};
  points.forEach((p) => { res[p.id] = 0; });
  const ajoute = (id, r) => { if (compte(r, limiteAttente, avecAttente)) res[id] = (res[id] || 0) + (r.quantite || 1); };

  const q = supabase.from('reservations').select('id, point_retrait_id, quantite, statut, source, created_at')
    .in('point_retrait_id', points.map((p) => p.id)).in('statut', ['confirmee', 'en_attente']);
  const { data, error } = await chevauche(q, debut, fin);
  if (!error) {
    (data || []).forEach((r) => ajoute(r.point_retrait_id, r));
    return res;
  }
  if (!colonnePointAbsente(error)) throw new Error(error.message || 'lecture des réservations impossible');
  // Colonne pas encore créée : repli sur l'adresse.
  for (const p of points) {
    const q2 = supabase.from('reservations').select('id, quantite, statut, source, created_at').eq('source_channel', 'click_collect')
      .ilike('adresse', `CLICK & COLLECT — ${p.nom} —%`).in('statut', ['confirmee', 'en_attente']);
    const { data: d2, error: e2 } = await chevauche(q2, debut, fin);
    if (e2) throw new Error(e2.message || 'lecture des réservations impossible');
    res[p.id] = 0;
    (d2 || []).forEach((r) => ajoute(p.id, r));
  }
  return res;
}

// Contrôle APRÈS l'enregistrement (course au dernier appareil) : on relit
// toutes les réservations du point qui comptent sur ces dates, dans l'ordre
// d'arrivée (id croissant). Si la nôtre arrive après la dernière place
// libre, elle est de trop. → true si la réservation `id` tient dans le stock.
// En cas de doute (lecture impossible), on la garde : le webhook revérifie.
async function tientDansLeStock(supabase, point, debut, fin, id) {
  const limiteAttente = new Date(Date.now() - ATTENTE_MAX_MIN * 60000).toISOString();
  let q = supabase.from('reservations').select('id, quantite, statut, source, created_at')
    .eq('point_retrait_id', point.id).in('statut', ['confirmee', 'en_attente']);
  let { data, error } = await chevauche(q, debut, fin).order('id', { ascending: true });
  if (error && colonnePointAbsente(error)) {
    q = supabase.from('reservations').select('id, quantite, statut, source, created_at').eq('source_channel', 'click_collect')
      .ilike('adresse', `CLICK & COLLECT — ${point.nom} —%`).in('statut', ['confirmee', 'en_attente']);
    ({ data, error } = await chevauche(q, debut, fin).order('id', { ascending: true }));
  }
  if (error || !Array.isArray(data)) return true;
  let pris = 0;
  for (const r of data) {
    // la nôtre compte toujours (même si elle vient d'être créée)
    if (r.id !== id && !compte(r, limiteAttente, true)) continue;
    pris += r.quantite || 1;
    if (r.id === id) return pris <= (point.stock || 0);
  }
  return true;
}

// Prix d'une location Click & Collect, avec la règle du prix fort.
// pricing : config du barème (pricing_config).
async function prixClickCollect(supabase, point, debut, jours, pricing) {
  const fin = addDaysISO(debut, jours);
  const cluster = pointsDuCluster(point);
  // Deux lectures : le PRIX ne suit que le confirmé ; la PLACE LIBRE tient
  // compte aussi des paiements en cours (moins de 30 min).
  const [occPrix, occStock] = await Promise.all([
    occupationParPoint(supabase, cluster, debut, fin, { avecAttente: false }),
    occupationParPoint(supabase, [point], debut, fin, { avecAttente: true }),
  ]);
  const capacite = cluster.reduce((s, p) => s + (p.stock || 0), 0);
  const pris = cluster.reduce((s, p) => s + (occPrix[p.id] || 0), 0);
  const tauxOccupation = capacite ? pris / capacite : 0;
  const libresAuPoint = Math.max(0, (point.stock || 0) - (occStock[point.id] || 0));

  // prix de base Click & Collect : 150 € les 7 jours (voir _lib/tarifDynamique.js)
  const normalCents = baseCents(jours, calcTieredPrice, pricing);
  const t = await appliquer({ normalCents, tauxOccupation, debut, fin, aujourdhui: todayParis(), point });
  return { fin, normalCents, totalCents: t.totalCents, plancherCents: t.plancherCents, plafondCents: t.plafondCents, remise: t.remise, variationPct: t.variationPct, majore: t.majore, majorationPct: t.majorationPct, raisons: t.raisons, signaux: t.signaux, multiplicateur: t.multiplicateur, libresAuPoint, tauxOccupation };
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
// Code retour (décision du propriétaire, 20/11/2026) : les 2 derniers
// chiffres du téléphone de la boutique. Le commerçant le donne au client qui
// rapporte un climatiseur ; le client le tape sur /retrait pour valider.
// Téléphone : champ « tel » du point (pointsRetrait.js), sinon le téléphone
// du commerçant (table partenaires). Risque accepté par le propriétaire :
// ce numéro est public, un client pourrait valider un faux retour.
function codeRetour(point, partenaire) {
  const tel = String((point && point.tel) || (partenaire && partenaire.telephone) || '').replace(/\D/g, '');
  return tel.length >= 2 ? tel.slice(-2) : null;
}
function lienRemise(reservationId, ref) {
  return `https://www.locair.fr/partenaire?remise=${reservationId}.${codeRemise(reservationId, ref)}`;
}
// Code pour ajouter la pièce d'identité APRÈS le paiement (écran « C'est
// réservé ») : seul le navigateur qui vient de payer le connaît.
function codeIdentite(reservationId, ref) {
  const secret = process.env.TRANSPORTEUR_SECRET || '';
  return crypto.createHmac('sha256', secret).update(`identite:${reservationId}:${ref || ''}`).digest('hex').slice(0, 24);
}
// Code de « reprise » d'un paiement : après une carte refusée, le navigateur
// le renvoie pour réutiliser le même paiement et la même réservation au lieu
// d'en bloquer une deuxième (voir api/checkout-click-collect.js).
function codeReprise(reservationId, ref) {
  const secret = process.env.TRANSPORTEUR_SECRET || '';
  return crypto.createHmac('sha256', secret).update(`reprise:${reservationId}:${ref || ''}`).digest('hex').slice(0, 24);
}
// Nouvelle référence de dossier, tirée au hasard par le serveur :
// « CC- » + 8 lettres/chiffres (sans 0/O/1/I, faciles à confondre).
function nouvelleRefCC() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(8);
  let s = 'CC-';
  for (let i = 0; i < 8; i++) s += A[b[i] % A.length];
  return s;
}
// Montant au format de la langue du client : « 150,00 € » (fr, es),
// « €150.00 » (en).
function montantLangue(cents, lang) {
  const v = (Math.round(Number(cents) || 0) / 100).toFixed(2);
  return lang === 'en' ? '€' + v : v.replace('.', ',') + ' €';
}
function imageQrRemise(reservationId, ref, taille = 240) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${taille}x${taille}&margin=8&data=${encodeURIComponent(lienRemise(reservationId, ref))}`;
}

module.exports = { codeRetour, prixClickCollect, occupationParPoint, tientDansLeStock, codeRemise, lienRemise, imageQrRemise, codeIdentite, codeReprise, nouvelleRefCC, montantLangue, SEUIL_PRIX_FORT, MAJORATION_PCT, ATTENTE_MAX_MIN, JOURS_MIN_CC, JOURS_MAX_CC, AVANCE_MAX_JOURS };
