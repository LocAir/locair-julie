// Click & Collect — stock par point, prix fort à 80 % d'occupation, code de
// remise (QR) — logique partagée par click-collect-prix.js (affichage),
// checkout-click-collect.js (paiement), partenaire-remise.js (scan du
// commerçant) et webhook.js (QR dans l'email).
//
// Modèle « stock figé » (plan opérationnel du propriétaire) : chaque point a
// un nombre fixe d'appareils pour la saison. Le prix suit la tarification
// dynamique de _lib/tarifDynamique.js (stock de la ville, chaleur prévue,
// dernière minute, période calme), toujours entre 99 € et 119 € les 3 jours, 139 € et 189 € les 7 jours.
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
const JOURS_MIN_CC = 3, JOURS_MAX_CC = 90, AVANCE_MAX_JOURS = 365;

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

// Le jour le plus chargé de la période [debut, fin) : nombre d'appareils
// pris ce jour-là. Deux locations qui ne se chevauchent pas (du 1er au 3,
// puis du 5 au 8) peuvent utiliser le même appareil : on ne les additionne
// pas, contrairement à un simple total sur la période.
function picDeJours(lignes, debut, fin) {
  let pic = 0;
  for (let d = debut; d < fin; d = addDaysISO(d, 1)) {
    let n = 0;
    for (const r of lignes) if (r.date_debut <= d && d < r.date_fin) n += r.quantite || 1;
    if (n > pic) pic = n;
  }
  return pic;
}

// Nombre d'appareils déjà pris à ces dates (le jour le plus chargé), point
// par point. Repère les réservations par point_retrait_id (après migration) ;
// avant la migration, par l'adresse « CLICK & COLLECT — <nom du point> — … ».
// options.avecAttente (true par défaut) : compter aussi les paiements en
// cours (moins de 30 min). false = seulement le confirmé (signal de prix).
const CHAMPS_OCC = 'id, point_retrait_id, quantite, statut, source, created_at, date_debut, date_fin';
async function occupationParPoint(supabase, points, debut, fin, options = {}) {
  const avecAttente = options.avecAttente !== false;
  const limiteAttente = new Date(Date.now() - ATTENTE_MAX_MIN * 60000).toISOString();
  const res = {};
  points.forEach((p) => { res[p.id] = 0; });
  const garder = (r) => compte(r, limiteAttente, avecAttente);

  const q = supabase.from('reservations').select(CHAMPS_OCC)
    .in('point_retrait_id', points.map((p) => p.id)).in('statut', ['confirmee', 'en_attente']);
  const { data, error } = await chevauche(q, debut, fin);
  if (!error) {
    points.forEach((p) => { res[p.id] = picDeJours((data || []).filter((r) => r.point_retrait_id === p.id && garder(r)), debut, fin); });
    return res;
  }
  if (!colonnePointAbsente(error)) throw new Error(error.message || 'lecture des réservations impossible');
  // Colonne pas encore créée : repli sur l'adresse.
  for (const p of points) {
    const q2 = supabase.from('reservations').select('id, quantite, statut, source, created_at, date_debut, date_fin').eq('source_channel', 'click_collect')
      .ilike('adresse', `CLICK & COLLECT — ${p.nom} —%`).in('statut', ['confirmee', 'en_attente']);
    const { data: d2, error: e2 } = await chevauche(q2, debut, fin);
    if (e2) throw new Error(e2.message || 'lecture des réservations impossible');
    res[p.id] = picDeJours((d2 || []).filter(garder), debut, fin);
  }
  return res;
}

// Contrôle APRÈS l'enregistrement (course au dernier appareil) : on relit
// les réservations du point qui comptent sur ces dates. Avant paiement
// (avecAttente = true), seules celles arrivées AVANT la nôtre (id plus
// petit) passent devant : premier arrivé, premier servi. Après paiement
// (avecAttente = false), toutes les réservations payées comptent.
// → true si la réservation `id` tient dans le stock, chaque jour.
// En cas de doute (lecture impossible), on la garde : le webhook revérifie.
async function tientDansLeStock(supabase, point, debut, fin, id, avecAttente = true) {
  const limiteAttente = new Date(Date.now() - ATTENTE_MAX_MIN * 60000).toISOString();
  let q = supabase.from('reservations').select('id, quantite, statut, source, created_at, date_debut, date_fin')
    .eq('point_retrait_id', point.id).in('statut', ['confirmee', 'en_attente']);
  let { data, error } = await chevauche(q, debut, fin);
  if (error && colonnePointAbsente(error)) {
    q = supabase.from('reservations').select('id, quantite, statut, source, created_at, date_debut, date_fin').eq('source_channel', 'click_collect')
      .ilike('adresse', `CLICK & COLLECT — ${point.nom} —%`).in('statut', ['confirmee', 'en_attente']);
    ({ data, error } = await chevauche(q, debut, fin));
  }
  if (error || !Array.isArray(data)) return true;
  // la nôtre compte toujours (même si elle vient d'être créée)
  const lignes = data.filter((r) => r.id === id || (compte(r, limiteAttente, avecAttente) && (!avecAttente || r.id < id)));
  if (!lignes.some((r) => r.id === id)) return true;
  return picDeJours(lignes, debut, fin) <= (point.stock || 0);
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

  // prix de base Click & Collect : 99 € les 3 jours, 150 € les 7 jours (voir _lib/tarifDynamique.js)
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
// NUMÉRO DE COMMANDE À 4 CHIFFRES (décision du propriétaire, 21/11/2026) :
// c'est ce que le client tape au comptoir après avoir scanné le QR code.
// Tiré de la référence interne (CC-XXXXXXXX, qui reste pour les factures,
// Stripe et /panne). Unique parmi les locations en cours du même point :
// checkout-click-collect.js retire une nouvelle référence en cas de doublon.
function numeroComptoir(ref) {
  const secret = process.env.TRANSPORTEUR_SECRET || '';
  const h = crypto.createHmac('sha256', secret).update(`comptoir:${String(ref || '').toUpperCase()}`).digest();
  return String(h.readUInt32BE(0) % 10000).padStart(4, '0');
}
function imageQrRemise(reservationId, ref, taille = 240) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${taille}x${taille}&margin=8&data=${encodeURIComponent(lienRemise(reservationId, ref))}`;
}

// Code commerçant pour valider un RETOUR (décision du propriétaire,
// 21/11/2026) : 4 caractères, lettres majuscules et chiffres (ex. « K7P3 »).
// Fixe pour chaque point, imprimé sur le demi-flyer remis au commerçant.
// Le client le demande au commerçant et le tape sur /retrait.
// Alphabet sans caractères qui se confondent (pas de O/0, I/1/L).
// La règle n'apparaît jamais dans le code du site public.
const LETTRES_CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const CHIFFRES_CODE = '23456789';
const ALPHABET_CODE = LETTRES_CODE + CHIFFRES_CODE;
function codeRetour(point) {
  const secret = process.env.TRANSPORTEUR_SECRET || '';
  if (!secret || !point || !point.id) return null;
  const h = crypto.createHmac('sha256', secret).update('code-retour:' + point.id).digest();
  const c = [0, 1, 2, 3].map((i) => ALPHABET_CODE[h[i] % ALPHABET_CODE.length]);
  // Toujours au moins une lettre et un chiffre.
  if (!c.some((x) => CHIFFRES_CODE.includes(x))) c[3] = CHIFFRES_CODE[h[4] % CHIFFRES_CODE.length];
  if (!c.some((x) => LETTRES_CODE.includes(x))) c[0] = LETTRES_CODE[h[5] % LETTRES_CODE.length];
  return c.join('');
}

module.exports = { numeroComptoir, codeRetour, prixClickCollect, occupationParPoint, tientDansLeStock, codeRemise, lienRemise, imageQrRemise, codeIdentite, codeReprise, nouvelleRefCC, montantLangue, SEUIL_PRIX_FORT, MAJORATION_PCT, ATTENTE_MAX_MIN, JOURS_MIN_CC, JOURS_MAX_CC, AVANCE_MAX_JOURS };
