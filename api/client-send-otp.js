const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');
const { sendBrevoSms, toE164FR } = require('./_lib/brevo');

const OTP_VALIDITY_MINUTES = 10;

// Même logique que reservations.js:normalizeTel — chiffres seulement, 10 digits FR
function normalizeTel(tel) {
  let digits = String(tel || '').replace(/\D/g, '');
  if (digits.startsWith('33') && digits.length === 11) digits = '0' + digits.slice(2);
  return digits;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();

  const ip = getClientIp(req);
  const rateKey = `otp:${ip}`;
  if (await isRateLimited(supabase, rateKey, 5, 15)) {
    return res.status(429).json({ error: 'Trop de tentatives — réessayez dans quelques minutes.' });
  }

  const rawTel = String((req.body || {}).tel || '').trim();
  if (!rawTel) {
    return res.status(400).json({ error: 'Numéro de téléphone requis.' });
  }

  const telNorm = normalizeTel(rawTel);
  if (telNorm.length < 9) {
    return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
  }

  // Format E.164 pour l'envoi SMS
  const telE164 = toE164FR(rawTel);
  if (!telE164) {
    return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
  }

  try {
    // Vérifie qu'au moins une réservation existe pour ce numéro (via tel_normalise dans clients)
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('tel_normalise', telNorm)
      .limit(1)
      .maybeSingle();

    // Réponse générique : on ne révèle pas si le numéro est connu
    if (!client) {
      await recordFailedAttempt(supabase, rateKey);
      return res.status(200).json({ ok: true });
    }

    // Génère un code à 6 chiffres
    const code = String(crypto.randomInt(100000, 999999));
    if (!process.env.TRANSPORTEUR_SECRET) throw new Error('TRANSPORTEUR_SECRET non configuré');
    const codeHash = crypto.createHmac('sha256', process.env.TRANSPORTEUR_SECRET)
      .update(telNorm + ':' + code)
      .digest('hex');
    const expiresAt = new Date(Date.now() + OTP_VALIDITY_MINUTES * 60000).toISOString();

    // Invalide les codes précédents pour ce numéro
    await supabase.from('otp_codes').update({ used: true })
      .eq('tel', telNorm).eq('used', false);

    // Sauvegarde le nouveau code
    await supabase.from('otp_codes').insert({ tel: telNorm, code_hash: codeHash, expires_at: expiresAt });

    await sendBrevoSms({
      to: telE164,
      content: `Votre code Loc'Air : ${code}\nValable ${OTP_VALIDITY_MINUTES} min. Ne le communiquez jamais.`,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[client-send-otp]', err.message);
    return res.status(500).json({ error: 'Erreur serveur — réessayez.' });
  }
};
