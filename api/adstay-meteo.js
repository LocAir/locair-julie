// Météo des tablettes AdStay (/adstay).
// Les tablettes appelaient Open-Meteo directement : au-delà de quelques appels,
// Open-Meteo répond 429 (trop de requêtes) et la température disparaît.
// Ici, une seule demande toutes les 15 minutes, partagée par toutes les tablettes
// (cache mémoire + cache CDN Vercel).

const DUREE = 15 * 60; // secondes
const cache = new Map(); // "lat,lon" → { t, data }

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method' });

  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return res.status(400).json({ error: 'coordonnees' });
  const cle = `${lat.toFixed(2)},${lon.toFixed(2)}`;

  let entree = cache.get(cle);
  if (!entree || Date.now() - entree.t > DUREE * 1000) {
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}`
        + '&current=temperature_2m,weather_code,is_day&daily=sunset&forecast_days=1&timezone=auto', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('open-meteo ' + r.status);
      const j = await r.json();
      entree = { t: Date.now(), data: {
        temperature: Math.round(j.current.temperature_2m),
        code: j.current.weather_code,
        jour: j.current.is_day === 1,
        coucher: String(j.daily?.sunset?.[0] || '').slice(11, 16), // heure locale, ex. « 18:42 »
      } };
      cache.set(cle, entree);
    } catch (e) {
      // Open-Meteo indisponible : on sert la dernière valeur connue s'il y en a une
      if (!entree) return res.status(502).json({ error: 'meteo_indisponible' });
    }
  }

  // Cache-Control est forcé à no-store pour /api dans vercel.json ;
  // l'en-tête dédié au CDN Vercel, lui, reste pris en compte.
  res.setHeader('Vercel-CDN-Cache-Control', `max-age=${DUREE}, stale-while-revalidate=3600`);
  return res.json(entree.data);
};
