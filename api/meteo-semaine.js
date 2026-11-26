// Météo de la semaine sur la Côte d'Azur (Nice, Cannes, Antibes) :
// température maximale prévue pour chacun des 7 prochains jours.
// Sert au bandeau « chaleur » de /click-and-collect et au déclencheur météo
// du lundi (voir CLAUDE.md). Le calcul est dans _lib/meteo.js, partagé avec
// la tarification dynamique.
const { previsionSemaine } = require('./_lib/meteo');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method' });
  const p = await previsionSemaine();
  if (!p) return res.status(502).json({ error: 'meteo_indisponible' });
  res.setHeader('Vercel-CDN-Cache-Control', 'max-age=3600, stale-while-revalidate=7200');
  return res.status(200).json({ maj: p.maj, max: p.max, villes: p.villes.map((v) => ({ ville: v.ville, jours: v.jours })) });
};
