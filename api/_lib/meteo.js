// Prévision de la semaine (max par jour) à Nice, Cannes et Antibes, via
// Open-Meteo. Partagée par api/meteo-semaine.js (bandeau chaleur, déclencheur
// du lundi) et par la tarification dynamique (_lib/tarifDynamique.js).
// Une demande par heure et par instance (cache mémoire). En cas d'échec :
// la dernière valeur connue, sinon null — jamais une chaleur inventée.
const DUREE_MS = 60 * 60 * 1000;
const VILLES = [
  { ville: 'Nice', lat: 43.70, lon: 7.27 },
  { ville: 'Cannes', lat: 43.55, lon: 7.01 },
  { ville: 'Antibes', lat: 43.58, lon: 7.12 },
];
let cache = null; // { t, data }

async function prevision(v) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${v.lat}&longitude=${v.lon}`
    + '&daily=temperature_2m_max&forecast_days=7&timezone=Europe%2FParis';
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('open-meteo ' + r.status);
  const j = await r.json();
  const dates = (j.daily && j.daily.time) || [], max = (j.daily && j.daily.temperature_2m_max) || [];
  return { ville: v.ville, lat: v.lat, lon: v.lon, jours: dates.map((d, i) => ({ date: d, max: Math.round(max[i]) })).filter((x) => Number.isFinite(x.max)) };
}

// { maj, max:{ville,date,max}, villes:[{ville,lat,lon,jours:[{date,max}]}] } ou null
async function previsionSemaine() {
  if (cache && Date.now() - cache.t < DUREE_MS) return cache.data;
  try {
    const villes = await Promise.all(VILLES.map(prevision));
    let haut = null;
    villes.forEach((v) => v.jours.forEach((j) => { if (!haut || j.max > haut.max) haut = { ville: v.ville, date: j.date, max: j.max }; }));
    if (!haut) throw new Error('prevision vide');
    cache = { t: Date.now(), data: { maj: new Date().toISOString(), max: haut, villes } };
  } catch (e) {
    console.error('[meteo]', e.message);
    if (!cache) return null;
  }
  return cache.data;
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

module.exports = { previsionSemaine, maxPeriode };
