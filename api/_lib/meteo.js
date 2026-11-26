// Prévision de la semaine (max par jour) à Nice, Cannes et Antibes, via
// Open-Meteo. Partagée par api/meteo-semaine.js (bandeau chaleur, déclencheur
// du lundi) et par la tarification dynamique (_lib/tarifDynamique.js).
// Une demande par heure et par instance (cache mémoire). En cas d'échec :
// la dernière valeur connue si elle a moins de 6 h, sinon null — jamais une
// chaleur inventée ni une prévision trop vieille (une « canicule » d'hier ne
// doit pas faire monter le prix d'aujourd'hui).
const DUREE_MS = 60 * 60 * 1000;          // prévision gardée 1 h
const VIEUX_MAX_MS = 6 * 60 * 60 * 1000;  // au-delà de 6 h, on ne s'en sert plus
const PAUSE_ECHEC_MS = 10 * 60 * 1000;    // après une panne, on ne réessaie pas avant 10 min
const VILLES = [
  { ville: 'Nice', lat: 43.70, lon: 7.27 },
  { ville: 'Cannes', lat: 43.55, lon: 7.01 },
  { ville: 'Antibes', lat: 43.58, lon: 7.12 },
];
let cache = null;      // { t, data }
let echecT = 0;       // heure de la dernière panne
let enCours = null;   // demande déjà partie (évite 10 appels en même temps)

async function prevision(v) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${v.lat}&longitude=${v.lon}`
    + '&daily=temperature_2m_max&forecast_days=7&timezone=Europe%2FParis';
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('open-meteo ' + r.status);
  const j = await r.json();
  const dates = (j.daily && j.daily.time) || [], max = (j.daily && j.daily.temperature_2m_max) || [];
  // Un jour sans valeur (null) est sauté : Math.round(null) donnerait 0 °C.
  const jours = [];
  dates.forEach((d, i) => { const t = max[i]; if (typeof t === 'number' && Number.isFinite(t)) jours.push({ date: d, max: Math.round(t) }); });
  return { ville: v.ville, lat: v.lat, lon: v.lon, jours };
}

// { maj, max:{ville,date,max}, villes:[{ville,lat,lon,jours:[{date,max}]}] } ou null
// Dernière valeur connue, seulement si elle a moins de 6 h.
function secours() {
  return cache && Date.now() - cache.t < VIEUX_MAX_MS ? cache.data : null;
}

async function previsionSemaine() {
  if (cache && Date.now() - cache.t < DUREE_MS) return cache.data;
  // Panne il y a moins de 10 min : on n'insiste pas (Open-Meteo limite les appels).
  if (echecT && Date.now() - echecT < PAUSE_ECHEC_MS) return secours();
  if (!enCours) {
    enCours = (async () => {
      try {
        const villes = await Promise.all(VILLES.map(prevision));
        let haut = null;
        villes.forEach((v) => v.jours.forEach((j) => { if (!haut || j.max > haut.max) haut = { ville: v.ville, date: j.date, max: j.max }; }));
        if (!haut) throw new Error('prevision vide');
        cache = { t: Date.now(), data: { maj: new Date().toISOString(), max: haut, villes } };
        echecT = 0;
      } catch (e) {
        console.error('[meteo]', e.message);
        echecT = Date.now();
      } finally {
        enCours = null;
      }
    })();
  }
  await enCours;
  return cache && Date.now() - cache.t < DUREE_MS ? cache.data : secours();
}

// Température max prévue entre debut et fin (AAAA-MM-JJ, fin exclue) pour la
// ville de prévision la plus proche du point ; null si hors des 7 jours.
async function maxPeriode(lat, lng, debut, fin) {
  const p = await previsionSemaine();
  if (!p) return null;
  let v = p.villes[0], d = Infinity;
  p.villes.forEach((x) => { const e = (x.lat - lat) ** 2 + (x.lon - lng) ** 2; if (e < d) { d = e; v = x; } });
  const t = v.jours.filter((j) => j.date >= debut && j.date < fin).map((j) => j.max);
  return t.length ? Math.max(...t) : null;
}

// Pour les tests uniquement : remet le cache à zéro.
function _reset() { cache = null; echecT = 0; enCours = null; }

module.exports = { previsionSemaine, maxPeriode, _reset };
