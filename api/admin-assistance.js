const { getSupabase } = require('./_lib/supabase');
const { checkAdminToken } = require('./_lib/auth');

// Coordonnées d'assistance affichées dans l'espace client (Module 4) — une
// seule ligne administrable, jamais codée en dur côté front.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'get';

  try {
    if (action === 'get') {
      const { data, error } = await supabase.from('assistance_config').select('*').eq('id', 1).maybeSingle();
      if (error) throw error;
      return res.status(200).json({ assistance: data });
    }

    if (action === 'update') {
      const patch = { updated_at: new Date().toISOString() };
      if (body.horaires  != null) patch.horaires  = String(body.horaires).trim().slice(0, 200) || null;
      if (body.telephone != null) patch.telephone = String(body.telephone).trim().slice(0, 50) || null;
      if (body.email     != null) patch.email     = String(body.email).trim().slice(0, 200) || null;
      if (body.urgence   != null) patch.urgence   = String(body.urgence).trim().slice(0, 500) || null;
      const { error } = await supabase.from('assistance_config').update(patch).eq('id', 1);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin assistance]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
