// Météo de la semaine sur la Côte d'Azur (Nice, Cannes, Antibes) :
// température maximale prévue pour chacun des 7 prochains jours.
//
// Sert à deux choses :
//   - le bandeau « chaleur » de /click-and-collect (affiché seulement s'il
//     fait vraiment chaud : jamais de chaleur inventée) ;
//   - le déclencheur météo du lundi (voir CLAUDE.md, « Déclencheur
//     météo ») : l'agent appelle cette page au lieu d'Open-Meteo, qui refuse
//     parfois les machines partagées.
//
// Une seule demande à Open-Meteo par heure, partagée par tous les visiteurs
// (cache mémoire + cache CDN Vercel), comme api/adstay-meteo.js.
const DUREE = 60 * 60; // secondes
const VILLES = [
  { ville: 'Nice', lat: 43.70, lon: 7.27 },
  { ville: 'Cannes', lat: 43.55, lon: 7.01 },
  { ville: 'Antibes', lat: 43.58, lon: 7.12 },
];
let cache = null; // { t, data }

async function prevision(v) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${v.lat}&longitude=${v.lon}`
    + '&daily=temperature_2m_max&forecast_days=7&timezone=Europe%2FParis';
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('open-meteo ' + r.status);
  const j = await r.json();
  const dates = (j.daily && j.daily.time) || [], max = (j.daily && j.daily.temperature_2m_max) || [];
  return { ville: v.ville, jours: dates.map((d, i) => ({ date: d, max: Math.round(max[i]) })).filter((x) => Number.isFinite(x.max)) };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method' });
  if (!cache || Date.now() - cache.t > DUREE * 1000) {
    try {
      const villes = await Promise.all(VILLES.map(prevision));
      let haut = null;
      villes.forEach((v) => v.jours.forEach((j) => { if (!haut || j.max > haut.max) haut = { ville: v.ville, date: j.date, max: j.max }; }));
      if (!haut) throw new Error('prevision vide');
      cache = { t: Date.now(), data: { maj: new Date().toISOString(), max: haut, villes } };
    } catch (e) {
      console.error('[meteo-semaine]', e.message);
      // Open-Meteo indisponible : dernière valeur connue s'il y en a une
      if (!cache) return res.status(502).json({ error: 'meteo_indisponible' });
    }
  }
  res.setHeader('Vercel-CDN-Cache-Control', `max-age=${DUREE}, stale-while-revalidate=7200`);
  return res.status(200).json(cache.data);
};
