// Tarification dynamique Click & Collect — inspirée de Beyond / PriceLabs
// (outils de prix des loueurs Airbnb) : plusieurs signaux de demande, chacun
// avec un effet mesuré, et surtout des BARRIÈRES que l'algorithme ne peut
// jamais franchir.
//
// ── Les 3 signaux ─────────────────────────────────────────────────────────
//  1. Stock    : part des appareils déjà réservés dans la ville (tous ses
//                points) sur les dates demandées. Plus il en reste peu, plus
//                le prix monte. (La règle d'origine « 80 % → +25 % » du
//                propriétaire, 18/11/2026, est le haut de cette courbe.)
//  2. Chaleur  : température max prévue sur la période (7 jours de
//                prévision Open-Meteo, ville la plus proche du point).
//  3. Dernière minute : retrait aujourd'hui ou demain, SEULEMENT si la
//                demande est déjà là (stock tendu ou chaleur) — jamais seul.
// Les effets se multiplient, puis passent par les barrières.
//
// ── Les barrières de sécurité ─────────────────────────────────────────────
//  • Plancher : jamais moins de 139 € les 7 jours (et la même proportion
//    pour les autres durées).
//  • Plafond  : jamais plus de 189 € les 7 jours, quoi qu'il arrive.
//  • Baisse   : seulement en période calme (temps frais prévu ET peu de
//    réservations), jamais par défaut.
//  • Même prix pour tout le monde au même moment : aucun signal lié à la
//    personne (appareil, adresse IP, historique, langue). Interdit de
//    personnaliser le prix.
//  • Panne d'un signal (météo indisponible…) = signal neutre (×1), donc un
//    prix plus bas, jamais plus haut.
//  • Interrupteur : variable Vercel TARIF_DYNAMIQUE=off → barème seul,
//    immédiatement, sans redéploiement du code.
//  • Prix garanti 30 min : le prix affiché au client est signé (devis) ;
//    s'il monte entre l'affichage et le paiement, le client paie le prix
//    affiché. S'il baisse, il paie le prix plus bas.
//  • Arrondi à l'euro, et chaque décision (signaux + effet) est gardée dans
//    le paiement Stripe pour pouvoir l'expliquer.
//  • Les prolongations ne sont jamais majorées (api/checkout-prolong.js
//    reste au barème) : on ne surprend pas un client déjà installé.
//
// Les chiffres ci-dessous sont des réglages, pas des promesses : ils se
// changent ici (et seulement ici).
const crypto = require('crypto');
const { maxPeriode } = require('./meteo');

// Prix Click & Collect décidés par le propriétaire (19/11/2026) : 150 € les
// 7 jours en temps normal, jamais moins de 139 €, jamais plus de 189 €.
// Les autres durées suivent la même proportion (barème dégressif × 150/prix
// de 7 jours au barème). La livraison (/reserver) n'est pas concernée.
const BASE_SEMAINE_EUR = 150, MIN_SEMAINE_EUR = 139, MAX_SEMAINE_EUR = 189;
const REGLES = {
  baseSemaineEur: BASE_SEMAINE_EUR, minSemaineEur: MIN_SEMAINE_EUR, maxSemaineEur: MAX_SEMAINE_EUR,
  plancher: MIN_SEMAINE_EUR / BASE_SEMAINE_EUR,   // ≈ 0,927 (−7 %)
  plafond: MAX_SEMAINE_EUR / BASE_SEMAINE_EUR,    // 1,26 (+26 %)
  // [part du stock déjà réservé, effet] — haut de courbe = plafond
  stock: [[0.80, MAX_SEMAINE_EUR / BASE_SEMAINE_EUR], [0.70, 1.12], [0.60, 1.06], [0.50, 1.03]],
  // période calme : temps frais prévu ET peu de réservations → plancher
  calme: { temperatureMax: 24, occupationMax: 0.30 },
  // [température max prévue (°C), effet]
  chaleur: [[33, 1.12], [31, 1.08], [29, 1.05], [27, 1.02]],
  derniereMinute: { joursMax: 1, effet: 1.05 },
  devisMinutes: 30,
};

function actif() { return String(process.env.TARIF_DYNAMIQUE || '').toLowerCase() !== 'off'; }
function palier(table, v) { for (const [seuil, effet] of table) if (v >= seuil) return effet; return 1; }
function joursEntre(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }

// ctx : { normalCents, tauxOccupation, debut, fin, aujourdhui, point:{lat,lng} }
// → { totalCents, multiplicateur, majore, majorationPct, raisons:[...], signaux:{...} }
async function appliquer(ctx) {
  const signaux = { stock: 1, chaleur: 1, derniereMinute: 1, calme: 1, temperature: null, occupation: Math.round((ctx.tauxOccupation || 0) * 100) / 100 };
  if (!actif()) return finir(ctx.normalCents, 1, signaux, ['desactive']);

  signaux.stock = palier(REGLES.stock, ctx.tauxOccupation || 0);
  try {
    const t = ctx.point ? await maxPeriode(ctx.point.lat, ctx.point.lng, ctx.debut, ctx.fin) : null;
    if (Number.isFinite(t)) { signaux.temperature = t; signaux.chaleur = palier(REGLES.chaleur, t); }
  } catch (e) { /* météo indisponible : signal neutre */ }
  if (Number.isFinite(signaux.temperature) && signaux.temperature < REGLES.calme.temperatureMax && (ctx.tauxOccupation || 0) < REGLES.calme.occupationMax) signaux.calme = REGLES.plancher;
  const delai = joursEntre(ctx.aujourdhui, ctx.debut);
  if (delai <= REGLES.derniereMinute.joursMax && (signaux.stock > 1 || signaux.chaleur > 1)) signaux.derniereMinute = REGLES.derniereMinute.effet;

  const brut = signaux.stock * signaux.chaleur * signaux.derniereMinute * signaux.calme;
  const raisons = [];
  if (signaux.stock > 1) raisons.push('stock');
  if (signaux.chaleur > 1) raisons.push('chaleur');
  if (signaux.derniereMinute > 1) raisons.push('derniere_minute');
  if (signaux.calme < 1) raisons.push('calme');
  return finir(ctx.normalCents, brut, signaux, raisons);
}

function bornesCents(normalCents) {
  return { min: Math.round(normalCents * REGLES.plancher / 100) * 100, max: Math.round(normalCents * REGLES.plafond / 100) * 100 };
}
function finir(normalCents, brut, signaux, raisons) {
  const m = Math.min(REGLES.plafond, Math.max(REGLES.plancher, brut));
  const b = bornesCents(normalCents);
  let total = Math.round(normalCents * m / 100) * 100;            // arrondi à l'euro
  total = Math.min(b.max, Math.max(b.min, total));
  const pct = Math.round((total / normalCents - 1) * 100);
  return { totalCents: total, plancherCents: b.min, plafondCents: b.max, multiplicateur: Math.round(m * 1000) / 1000,
    majore: total > normalCents, remise: total < normalCents, majorationPct: Math.max(0, pct), variationPct: pct,
    raisons: total !== normalCents ? raisons : [], signaux };
}
// Prix de base Click & Collect (avant tarif dynamique), en centimes, arrondi
// à l'euro : barème dégressif × (150 € / prix de 7 jours au barème).
function baseCents(jours, calcTieredPrice, pricing) {
  const sept = calcTieredPrice(7, pricing);
  const f = sept > 0 ? REGLES.baseSemaineEur / sept : 1;
  return Math.round(calcTieredPrice(jours, pricing) * f) * 100;
}
function facteurCC(calcTieredPrice, pricing) { const sept = calcTieredPrice(7, pricing); return sept > 0 ? REGLES.baseSemaineEur / sept : 1; }

// ── Devis signé : le prix affiché reste garanti 30 minutes ───────────────
function secret() { return process.env.TRANSPORTEUR_SECRET || ''; }
function signerDevis({ point, debut, jours, cents }) {
  const corps = Buffer.from(JSON.stringify({ p: point, d: debut, j: jours, c: cents, t: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update('devis:' + corps).digest('base64url').slice(0, 32);
  return corps + '.' + sig;
}
// → montant garanti (cents) ou null si le devis n'est pas valable pour ces paramètres
function lireDevis(devis, { point, debut, jours }) {
  try {
    const [corps, sig] = String(devis || '').split('.');
    if (!corps || !sig || !secret()) return null;
    const attendu = crypto.createHmac('sha256', secret()).update('devis:' + corps).digest('base64url').slice(0, 32);
    if (sig.length !== attendu.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(attendu))) return null;
    const d = JSON.parse(Buffer.from(corps, 'base64url').toString());
    if (d.p !== point || d.d !== debut || d.j !== jours) return null;
    if (!(Date.now() - d.t >= 0 && Date.now() - d.t <= REGLES.devisMinutes * 60000)) return null;
    return Number.isInteger(d.c) && d.c > 0 ? d.c : null;
  } catch (e) { return null; }
}

module.exports = { appliquer, signerDevis, lireDevis, baseCents, facteurCC, bornesCents, REGLES };
