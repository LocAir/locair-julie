const { getSupabase }     = require('./_lib/supabase');
const { getCity }          = require('./_lib/city');
const { checkAdminToken }  = require('./_lib/auth');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');

  const supabase = getSupabase();

  // GET — lecture publique de l'état sold_out
  if (req.method === 'GET') {
    try {
      const city = await getCity(supabase);
      return res.status(200).json({ sold_out: city.sold_out === true });
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
      const city   = await getCity(supabase);
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
