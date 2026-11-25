const { getSupabase } = require('./_lib/supabase');
const { safeEqual, signTransporteurToken } = require('./_lib/auth');
const { hashPin, verifyPin } = require('./_lib/pinHash');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const pin = String((req.body || {}).pin || '').trim();
  if (!pin) return res.status(400).json({ error: 'Code manquant' });
  if (!process.env.TRANSPORTEUR_SECRET) {
    console.error('[Transporteur login] TRANSPORTEUR_SECRET manquant');
    return res.status(500).json({ error: 'Erreur serveur' });
  }

  const supabase = getSupabase();
  const rateKey = `transporteur:${getClientIp(req)}`;

  try {
    // Connexion par code seul (sans identifiant) : le code est comparé à
    // TOUS les comptes. En plus de la limite par adresse IP, une limite
    // globale empêche de deviner un code en changeant d'adresse : 30 essais
    // ratés en 15 min, toutes adresses confondues, puis pause.
    if (await isRateLimited(supabase, 'transporteur:global', 30, 15)) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 15 minutes ou contacte Aly.' });
    }
    if (await isRateLimited(supabase, rateKey)) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 15 minutes ou contacte Aly.' });
    }

    const { data, error } = await supabase.from('transporteurs').select('id, nom, pin, pin_hashed').eq('actif', true);
    if (error) throw error;

    const match = (data || []).find(t =>
      t.pin_hashed ? verifyPin(pin, t.pin) : safeEqual(pin, t.pin || '')
    );
    if (!match) {
      await recordFailedAttempt(supabase, rateKey);
      await recordFailedAttempt(supabase, 'transporteur:global').catch(() => {});
      return res.status(401).json({ error: 'Code incorrect' });
    }

    let currentPin = match.pin;
    if (!match.pin_hashed) {
      const hashed = hashPin(pin);
      const { error: migErr } = await supabase.from('transporteurs')
        .update({ pin: hashed, pin_hashed: true }).eq('id', match.id);
      if (!migErr) currentPin = hashed;
      else console.error('[Transporteur PIN migration]', migErr.message);
    }

    return res.status(200).json({
      token: signTransporteurToken(match.id, currentPin),
      transporteur_id: match.id,
      nom: match.nom,
    });
  } catch (err) {
    console.error('[Transporteur login]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
