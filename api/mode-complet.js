const { getSupabase }     = require('./_lib/supabase');
const { getCity }         = require('./_lib/city');
const { getAvailability } = require('./_lib/stock');

// sold_out est recalculé automatiquement en base (triggers de
// migration_auto_sold_out.sql, à partir du stock réel) — cet endpoint est
// en lecture seule, il n'y a plus de bascule manuelle.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

  // Lecture publique de l'état sold_out + compteur temps réel (le site en
  // fait un texte "Plus que N appareil(s) disponible(s)" synchronisé avec le
  // vrai stock, y compris les appareils marqués "loué" hors système).
  try {
    const city = await getCity(supabase);
    const today    = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const disponibles = Math.max(0, await getAvailability(supabase, city.id, today, tomorrow));
    return res.status(200).json({ sold_out: city.sold_out === true, disponibles });
  } catch (err) {
    console.error('[mode-complet GET]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
