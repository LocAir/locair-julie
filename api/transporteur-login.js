const { getSupabase } = require('./_lib/supabase');
const { safeEqual, signTransporteurToken } = require('./_lib/auth');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const pin = ((req.body || {}).pin || '').trim();
  if (!pin) return res.status(400).json({ error: 'Code manquant' });
  if (!process.env.TRANSPORTEUR_SECRET) {
    console.error('[Transporteur login] TRANSPORTEUR_SECRET manquant');
    return res.status(500).json({ error: 'Erreur serveur' });
  }

  const supabase = getSupabase();
  const rateKey = `transporteur:${getClientIp(req)}`;

  try {
    if (await isRateLimited(supabase, rateKey)) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 15 minutes ou contacte Aly.' });
    }

    const { data, error } = await supabase.from('transporteurs').select('id, nom, pin').eq('actif', true);
    if (error) throw error;

    const match = (data || []).find(t => safeEqual(pin, t.pin || ''));
    if (!match) {
      await recordFailedAttempt(supabase, rateKey);
      return res.status(401).json({ error: 'Code incorrect' });
    }

    return res.status(200).json({
      token: signTransporteurToken(match.id, match.pin),
      transporteur_id: match.id,
      nom: match.nom,
    });
  } catch (err) {
    console.error('[Transporteur login]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
