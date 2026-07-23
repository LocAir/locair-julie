const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const transporteurId = await verifyTransporteurToken(req, supabase);
  if (!transporteurId) return res.status(401).json({ error: 'Session invalide' });

  const lat = parseFloat((req.body || {}).lat);
  const lng = parseFloat((req.body || {}).lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: 'Position invalide' });
  }

  try {
    const { error } = await supabase.from('transporteurs').update({
      position_lat: lat,
      position_lng: lng,
      position_at:  new Date().toISOString(),
    }).eq('id', transporteurId);
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Transporteur position]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
