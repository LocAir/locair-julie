// Disponibilité de chaque point de retrait, pour les épingles de la carte
// (/click-and-collect) : vert = disponible, orange = dernier appareil,
// gris = complet. Calculée sur la location type (retrait demain, 7 jours),
// avec le même calcul que le paiement (occupationParPoint).
// Jamais le nombre exact d'appareils : seulement ces 3 états.
// Un point d'exemple n'a pas d'état (il n'est pas encore ouvert).
const { getSupabase } = require('./_lib/supabase');
const { POINTS_RETRAIT } = require('./_lib/pointsRetrait');
const { occupationParPoint } = require('./_lib/clickCollect');

function demainParis() {
  const auj = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
  const d = new Date(auj + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function plus(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  // 1 min dans le cache de Vercel : à jour, sans relire la base à chaque visite.
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  const test = (req.query || {}).test === '1';
  const ouverts = POINTS_RETRAIT.filter((p) => !p.exemple && (test || !p.test));
  const debut = demainParis(), fin = plus(debut, 7);
  const etats = {};
  if (ouverts.length) {
    try {
      const occ = await occupationParPoint(getSupabase(), ouverts, debut, fin, { avecAttente: true });
      for (const p of ouverts) {
        const libres = Math.max(0, (p.stock || 0) - (occ[p.id] || 0));
        etats[p.id] = libres >= 2 ? 'dispo' : libres === 1 ? 'dernier' : 'complet';
      }
    } catch (e) {
      // lecture impossible : pas d'état plutôt qu'un faux « complet »
      console.error('[points-dispo]', e.message);
    }
  }
  return res.status(200).json({ debut, etats });
};
