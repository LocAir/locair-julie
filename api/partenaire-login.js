const { getSupabase } = require('./_lib/supabase');
const { safeEqual, signPartenaireToken } = require('./_lib/auth');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const pin = ((req.body || {}).pin || '').trim();
  if (!pin) return res.status(400).json({ error: 'Code manquant' });
  if (!process.env.TRANSPORTEUR_SECRET) {
    console.error('[Partenaire login] TRANSPORTEUR_SECRET manquant');
    return res.status(500).json({ error: 'Erreur serveur' });
  }

  const supabase = getSupabase();
  const rateKey = `partenaire:${getClientIp(req)}`;

  try {
    if (await isRateLimited(supabase, rateKey)) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 15 minutes ou contacte Loc\'Air.' });
    }

    const { data, error } = await supabase.from('partenaires').select('id, nom, code, pin, taux_commission_pct').eq('actif', true);
    if (error) throw error;

    const match = (data || []).find(p => safeEqual(pin, p.pin || ''));
    if (!match) {
      await recordFailedAttempt(supabase, rateKey);
      return res.status(401).json({ error: 'Code incorrect' });
    }

    return res.status(200).json({
      token: signPartenaireToken(match.id, match.pin),
      partenaire_id: match.id,
      nom: match.nom,
      code: match.code,
      taux_commission_pct: match.taux_commission_pct,
    });
  } catch (err) {
    console.error('[Partenaire login]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
