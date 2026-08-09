// Tableau de bord Publicité (admin) — vraies statistiques Google Ads.
const { getSupabase } = require('./_lib/supabase');
const { checkAdminToken } = require('./_lib/auth');
const { isGoogleAdsConfigured, getGoogleAdsSummary } = require('./_lib/googleAds');

function fmtDate(d) { return d.toISOString().slice(0, 10); }

// Mêmes libellés de période que le reste de l'admin (voir admin-dashboard.js)
// pour que l'onglet Publicité se comporte comme les autres.
function periodDates(periode) {
  const end = new Date();
  const start = new Date();
  if (periode === 'jour') { /* aujourd'hui seulement, start = end plus bas */ }
  else if (periode === '30j') { start.setDate(start.getDate() - 30); }
  else if (periode === 'mois') { start.setDate(1); }
  else { start.setDate(start.getDate() - 7); } // '7j' par défaut
  return { start: fmtDate(periode === 'jour' ? end : start), end: fmtDate(end) };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  if (!isGoogleAdsConfigured()) {
    return res.status(200).json({ configured: false });
  }

  const periode = (req.body || {}).periode || '7j';
  const { start, end } = periodDates(periode);

  try {
    const data = await getGoogleAdsSummary(start, end);
    return res.status(200).json({ configured: true, periode, ...data });
  } catch (err) {
    console.error('[Admin Google Ads]', err.message);
    return res.status(502).json({ configured: true, error: 'Impossible de récupérer les données Google Ads pour le moment.' });
  }
};
