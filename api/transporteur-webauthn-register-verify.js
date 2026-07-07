const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');
const { getRpConfig, extractChallenge, consumeChallenge } = require('./_lib/webauthn');
const { verifyRegistrationResponse } = require('@simplewebauthn/server');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const transporteurId = await verifyTransporteurToken(req, supabase);
  if (!transporteurId) return res.status(401).json({ error: 'Session invalide' });

  try {
    const response = (req.body || {}).response;
    const challenge = extractChallenge(response);
    if (!(await consumeChallenge(supabase, challenge))) {
      return res.status(400).json({ error: 'Session d\'inscription expirée, réessaie' });
    }

    const { rpID, origin } = getRpConfig(req);
    const verification = await verifyRegistrationResponse({
      response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Vérification échouée' });
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const { error } = await supabase.from('webauthn_credentials').insert({
      transporteur_id: transporteurId,
      credential_id:   credential.id,
      public_key:      Buffer.from(credential.publicKey).toString('base64url'),
      counter:         credential.counter,
      device_type:     credentialDeviceType,
      backed_up:       credentialBackedUp,
    });
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Webauthn register verify]', err.message);
    return res.status(400).json({ error: 'Vérification échouée' });
  }
};
