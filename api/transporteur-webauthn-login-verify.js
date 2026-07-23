const { getSupabase } = require('./_lib/supabase');
const { getRpConfig, extractChallenge, consumeChallenge } = require('./_lib/webauthn');
const { verifyAuthenticationResponse } = require('@simplewebauthn/server');
const { signTransporteurToken } = require('./_lib/auth');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();

  const rateKey = `webauthn:${getClientIp(req)}`;
  if (await isRateLimited(supabase, rateKey)) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 15 minutes ou contacte Aly.' });
  }

  try {
    const response = (req.body || {}).response;
    const credentialId = response?.id;
    if (!credentialId) return res.status(400).json({ error: 'Réponse invalide' });

    const { data: cred } = await supabase
      .from('webauthn_credentials').select('id, credential_id, transporteur_id, public_key, counter')
      .eq('credential_id', credentialId).maybeSingle();
    if (!cred) {
      await recordFailedAttempt(supabase, rateKey);
      return res.status(401).json({ error: 'Appareil non reconnu — connecte-toi avec ton code' });
    }

    const { data: t } = await supabase
      .from('transporteurs').select('id, pin, nom, actif').eq('id', cred.transporteur_id).maybeSingle();
    if (!t || !t.actif) {
      await recordFailedAttempt(supabase, rateKey);
      return res.status(401).json({ error: 'Compte désactivé' });
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

    const { error: counterErr } = await supabase.from('webauthn_credentials')
      .update({ counter: verification.authenticationInfo.newCounter }).eq('id', cred.id);
    if (counterErr) console.error('[Webauthn transporteur] counter update failed:', counterErr.message);

    return res.status(200).json({ token: signTransporteurToken(t.id, t.pin), transporteur_id: t.id, nom: t.nom });
  } catch (err) {
    console.error('[Webauthn login verify]', err.message);
    return res.status(401).json({ error: 'Vérification échouée' });
  }
};
