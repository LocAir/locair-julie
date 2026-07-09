const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const transporteurId = await verifyTransporteurToken(req, supabase);
  if (!transporteurId) return res.status(401).json({ error: 'Session invalide' });

  const sub = (req.body || {}).subscription;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return res.status(400).json({ error: 'Abonnement invalide' });
  }

  try {
    const { error } = await supabase.from('push_subscriptions').upsert({
      transporteur_id: transporteurId,
      endpoint:        sub.endpoint,
      p256dh:          sub.keys.p256dh,
      auth:            sub.keys.auth,
    }, { onConflict: 'endpoint' });
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Transporteur push subscribe]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
