const { getSupabase } = require('./_lib/supabase');
const { safeEqual, signPartenaireToken } = require('./_lib/auth');
const { hashPin, verifyPin } = require('./_lib/pinHash');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const pin  = ((req.body || {}).pin  || '').trim();
  const code = ((req.body || {}).code || '').trim().toLowerCase();
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

    // Quand le code d'affiliation est fourni (nouveau formulaire), on cible
    // directement le bon enregistrement via l'index unique — O(1) scrypt au
    // lieu de O(n). Repli sur le scan complet uniquement si pas de code
    // (ancien signet sans code), pour ne pas casser les sessions existantes.
    let data, error;
    if (code) {
      ({ data, error } = await supabase.from('partenaires')
        .select('id, nom, code, pin, pin_hashed, taux_commission_pct')
        .eq('actif', true).eq('code', code).maybeSingle());
      data = data ? [data] : [];
    } else {
      ({ data, error } = await supabase.from('partenaires')
        .select('id, nom, code, pin, pin_hashed, taux_commission_pct')
        .eq('actif', true).order('id'));
    }
    if (error) throw error;

    const match = (data || []).find(p =>
      p.pin_hashed ? verifyPin(pin, p.pin) : safeEqual(pin, p.pin || '')
    );
    if (!match) {
      await recordFailedAttempt(supabase, rateKey);
      return res.status(401).json({ error: 'Code incorrect' });
    }

    // Migration progressive : si le PIN était en clair, on le hache maintenant
    // avant de signer le token — sinon le fingerprint dans le token (hash)
    // diffère immédiatement de celui en base (plain), invalide toute session.
    let currentPin = match.pin;
    if (!match.pin_hashed) {
      const hashed = hashPin(pin);
      const { error: migErr } = await supabase.from('partenaires')
        .update({ pin: hashed, pin_hashed: true }).eq('id', match.id);
      if (!migErr) currentPin = hashed;
      else console.error('[Partenaire PIN migration]', migErr.message);
    }

    return res.status(200).json({
      token: signPartenaireToken(match.id, currentPin),
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
