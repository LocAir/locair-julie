const { getSupabase } = require('./_lib/supabase');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');
const { signClientToken } = require('./_lib/auth');

// Accès espace client (Module 4) — pas de compte, pas de mot de passe :
// email + numéro de commande, exactement le même principe déjà en place sur
// /prolongation (api/prolong-lookup.js). Message d'erreur volontairement
// générique dans tous les cas d'échec (email inconnu, ref inconnue, ref ne
// correspondant pas à cet email) pour ne jamais laisser deviner quelle
// réservation existe.
const GENERIC_ERROR = "Nous n'avons pas retrouvé votre réservation. Merci de vérifier votre numéro de commande et votre adresse email.";

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();

  const ip = getClientIp(req);
  const rateKey = `client:${ip}`;
  if (await isRateLimited(supabase, rateKey)) {
    return res.status(429).json({ error: 'Trop de tentatives — réessayez dans quelques minutes.' });
  }

  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const ref   = String((req.body || {}).ref || '').trim().toUpperCase();
  if (!email || !ref) {
    await recordFailedAttempt(supabase, rateKey);
    return res.status(400).json({ error: GENERIC_ERROR });
  }

  try {
    const { data: resa, error } = await supabase
      .from('reservations')
      .select('id, ref, email')
      .eq('email', email)
      .eq('ref', ref)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    if (!resa) {
      await recordFailedAttempt(supabase, rateKey);
      return res.status(404).json({ error: GENERIC_ERROR });
    }

    const token = signClientToken(resa.id, resa.ref);
    return res.status(200).json({ ok: true, token, ref: resa.ref });
  } catch (err) {
    // Jamais de détail Supabase/SQL renvoyé au client — journalisé côté
    // serveur uniquement (consultable dans les logs Vercel par l'admin).
    console.error('[client-login]', err.message);
    return res.status(500).json({ error: GENERIC_ERROR });
  }
};
