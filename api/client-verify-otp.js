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
      // Limite PAR NUMÉRO (pas seulement par adresse IP) : 5 mauvais codes et
      // le code en cours est annulé — il faut en redemander un.
      const cleTel = `otp-tel:${telNorm}`;
      await recordFailedAttempt(supabase, cleTel).catch(() => {});
      if (otp && await isRateLimited(supabase, cleTel, 5, 15).catch(() => false)) {
        await supabase.from('otp_codes').update({ used: true }).eq('id', otp.id);
      }
      return res.status(401).json({ error: GENERIC_ERROR });
    }

    // Récupère le(s) client(s) pour ce numéro — une fiche par ville — AVANT
    // de consommer le code.
    const { data: clientsTel } = await supabase
      .from('clients')
      .select('id')
      .eq('tel_normalise', telNorm)
      .limit(20);
    const clientIds = (clientsTel || []).map((c) => c.id);

    if (!clientIds.length) {
      return res.status(404).json({ error: GENERIC_ERROR });
    }

    // La réservation à ouvrir (pas une prolongation) : d'abord une location
    // payée (en cours, puis terminée), jamais un paiement abandonné ou annulé
    // quand une vraie location existe.
    const { data: resas } = await supabase
      .from('reservations')
      .select('id, ref, reservation_origine_id, statut')
      .in('client_id', clientIds)
      .is('reservation_origine_id', null)
      .order('created_at', { ascending: false })
      .limit(30);
    const rang = (r) => (r.statut === 'confirmee' ? 0 : r.statut === 'terminee' ? 1 : 2);
    const resa = (resas || []).slice().sort((x, y) => rang(x) - rang(y))[0] || null;

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
