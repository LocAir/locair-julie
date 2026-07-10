const { getSupabase }     = require('./_lib/supabase');
const { getCity, resolveAdminCity } = require('./_lib/city');
const { checkAdminToken }  = require('./_lib/auth');
const { getAvailability } = require('./_lib/stock');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');

  const supabase = getSupabase();

  // GET — lecture publique de l'état sold_out + compteur temps réel (le site
  // en fait un texte "Plus que N appareil(s) disponible(s)" synchronisé avec
  // le vrai stock, y compris les appareils marqués "loué" hors système).
  if (req.method === 'GET') {
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
  }

  // POST — toggle admin (nécessite ADMIN_PASSWORD)
  if (req.method === 'POST') {
    if (!(await checkAdminToken(req, supabase))) {
      return res.status(401).json({ error: 'Non autorisé' });
    }
    try {
      const city = await resolveAdminCity(supabase, req.body);
      if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });
      const newVal = req.body?.sold_out !== undefined
        ? Boolean(req.body.sold_out)
        : !city.sold_out;
      const { error } = await supabase
        .from('cities')
        .update({ sold_out: newVal })
        .eq('id', city.id);
      if (error) throw error;
      return res.status(200).json({ ok: true, sold_out: newVal });
    } catch (err) {
      console.error('[mode-complet POST]', err.message);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
