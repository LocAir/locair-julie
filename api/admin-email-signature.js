const { getSupabase } = require('./_lib/supabase');
const { checkAdminToken } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'get';

  try {
    if (action === 'get') {
      const { data, error } = await supabase.from('email_signature').select('*').eq('id', 1).maybeSingle();
      if (error) throw error;
      return res.status(200).json({ signature: data });
    }

    if (action === 'update') {
      const patch = { updated_at: new Date().toISOString() };
      if (body.nom_expediteur != null) patch.nom_expediteur = String(body.nom_expediteur).trim().slice(0, 200) || "Loc'Air";
      if (body.fonction       != null) patch.fonction       = String(body.fonction).trim().slice(0, 200) || null;
      if (body.logo_url       != null) patch.logo_url       = String(body.logo_url).trim().slice(0, 500) || null;
      if (body.telephone      != null) patch.telephone      = String(body.telephone).trim().slice(0, 50) || null;
      if (body.email          != null) patch.email          = String(body.email).trim().slice(0, 200) || 'contact@locair.fr';
      if (body.site_web       != null) patch.site_web       = String(body.site_web).trim().slice(0, 300) || null;

      const { error } = await supabase.from('email_signature').upsert({ id: 1, ...patch }, { onConflict: 'id' });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin email signature]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
