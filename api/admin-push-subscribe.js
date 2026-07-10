const { getSupabase } = require('./_lib/supabase');
const { checkAdminToken } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const sub = (req.body || {}).subscription;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return res.status(400).json({ error: 'Abonnement invalide' });
  }

  try {
    const { error } = await supabase.from('admin_push_subscriptions').upsert({
      endpoint: sub.endpoint,
      p256dh:   sub.keys.p256dh,
      auth:     sub.keys.auth,
    }, { onConflict: 'endpoint' });
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Admin push subscribe]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
