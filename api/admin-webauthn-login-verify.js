const { getSupabase } = require('./_lib/supabase');
const { getRpConfig, extractChallenge, consumeChallenge } = require('./_lib/webauthn');
const { verifyAuthenticationResponse } = require('@simplewebauthn/server');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();

  const rateKey = `admin-webauthn:${getClientIp(req)}`;
  if (await isRateLimited(supabase, rateKey)) {
    return res.status(429).json({ error: 'Trop de tentatives, réessaie plus tard' });
  }

  try {
    const response = (req.body || {}).response;
    const credentialId = response?.id;
    if (!credentialId) return res.status(400).json({ error: 'Réponse invalide' });

    const { data: cred } = await supabase
      .from('admin_webauthn_credentials').select('id, credential_id, public_key, counter')
      .eq('credential_id', credentialId).maybeSingle();
    if (!cred) {
      await recordFailedAttempt(supabase, rateKey);
      return res.status(401).json({ error: 'Appareil non reconnu — connecte-toi avec le mot de passe' });
    }

    const challenge = extractChallenge(response);
    if (!(await consumeChallenge(supabase, challenge))) {
      return res.status(400).json({ error: 'Session expirée, réessaie' });
    }

    const { rpID, origin } = getRpConfig(req);
    const verification = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID,
      credential: {
        id:        cred.credential_id,
        publicKey: Buffer.from(cred.public_key, 'base64url'),
        counter:   cred.counter,
      },
    });
    if (!verification.verified) {
      await recordFailedAttempt(supabase, rateKey);
      return res.status(401).json({ error: 'Vérification échouée' });
    }

    const { error: counterErr } = await supabase.from('admin_webauthn_credentials')
      .update({ counter: verification.authenticationInfo.newCounter }).eq('id', cred.id);
    if (counterErr) console.error('[Admin webauthn] counter update failed:', counterErr.message);

    // Le "jeton" admin est le mot de passe lui-même (voir checkAdminToken) —
    // la biométrie ne fait que le redonner au client une fois l'appareil
    // reconnu, exactement comme la saisie manuelle le ferait.
    if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: 'Configuration serveur incomplète' });
    return res.status(200).json({ token: process.env.ADMIN_PASSWORD });
  } catch (err) {
    console.error('[Admin webauthn login verify]', err.message);
    return res.status(401).json({ error: 'Vérification échouée' });
  }
};
