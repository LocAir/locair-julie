const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');
const { signClientToken } = require('./_lib/auth');

const GENERIC_ERROR = "Code invalide ou expiré.";

function normalizeTel(tel) {
  let digits = String(tel || '').replace(/\D/g, '');
  if (digits.startsWith('33') && digits.length === 11) digits = '0' + digits.slice(2);
  return digits;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();

  const ip = getClientIp(req);
  const rateKey = `otp-verify:${ip}`;
  if (await isRateLimited(supabase, rateKey, 10, 15)) {
    return res.status(429).json({ error: 'Trop de tentatives — réessayez dans quelques minutes.' });
  }

  const rawTel = String((req.body || {}).tel || '').trim();
  const code   = String((req.body || {}).code || '').trim().replace(/\D/g, '');

  if (!rawTel || !code) {
    return res.status(400).json({ error: GENERIC_ERROR });
  }

  const telNorm = normalizeTel(rawTel);
  if (telNorm.length < 9 || code.length !== 6) {
    await recordFailedAttempt(supabase, rateKey);
    return res.status(400).json({ error: GENERIC_ERROR });
  }

  if (!process.env.TRANSPORTEUR_SECRET) throw new Error('TRANSPORTEUR_SECRET non configuré');
  const expectedHash = crypto.createHmac('sha256', process.env.TRANSPORTEUR_SECRET)
    .update(telNorm + ':' + code)
    .digest('hex');

  try {
    // Cherche un code valide (non expiré, non utilisé)
    const now = new Date().toISOString();
    const { data: otp } = await supabase
      .from('otp_codes')
      .select('id, code_hash')
      .eq('tel', telNorm)
      .eq('used', false)
      .gt('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otp || otp.code_hash !== expectedHash) {
      await recordFailedAttempt(supabase, rateKey);
      return res.status(401).json({ error: GENERIC_ERROR });
    }

    // Récupère le client pour ce numéro — AVANT de consommer le code
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('tel_normalise', telNorm)
      .limit(1)
      .maybeSingle();

    if (!client) {
      return res.status(404).json({ error: GENERIC_ERROR });
    }

    // Cherche la réservation principale (pas une prolongation) la plus récente
    const { data: resa } = await supabase
      .from('reservations')
      .select('id, ref, reservation_origine_id')
      .eq('client_id', client.id)
      .is('reservation_origine_id', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!resa) {
      return res.status(404).json({ error: GENERIC_ERROR });
    }

    // Marque le code comme utilisé seulement après avoir vérifié client+résa
    await supabase.from('otp_codes').update({ used: true }).eq('id', otp.id);

    const token = signClientToken(resa.id, resa.ref);
    return res.status(200).json({ ok: true, token, ref: resa.ref });
  } catch (err) {
    console.error('[client-verify-otp]', err.message);
    return res.status(500).json({ error: 'Erreur serveur — réessayez.' });
  }
};
