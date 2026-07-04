const { getSupabase } = require('./_lib/supabase');
const { getCity }     = require('./_lib/city');
const { getAvailability } = require('./_lib/stock');
const { checkAdminToken } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body = req.body || {};

  try {
    if (body.action === 'update') {
      const flotte = parseInt(body.flotte_totale);
      if (!Number.isFinite(flotte) || flotte < 0) return res.status(400).json({ error: 'Valeur invalide' });
      const city = await getCity(supabase);
      const { error } = await supabase.from('cities').update({ flotte_totale: flotte }).eq('id', city.id);
      if (error) throw error;
    }

    const city = await getCity(supabase);
    const today    = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const disponibles = Math.max(0, await getAvailability(supabase, city.id, today, tomorrow));
    const enLocation  = Math.max(0, city.flotte_totale - disponibles);

    return res.status(200).json({ ville: city.name, flotte_totale: city.flotte_totale, disponibles, en_location: enLocation });
  } catch (err) {
    console.error('[Admin stock]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
