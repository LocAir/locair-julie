const { getSupabase } = require('./_lib/supabase');
const { getRpConfig, storeChallenge } = require('./_lib/webauthn');
const { generateAuthenticationOptions } = require('@simplewebauthn/server');

// Endpoint public (avant identification) — c'est le point d'entrée de la
// connexion biométrique, il n'y a donc pas encore de jeton transporteur à
// vérifier. L'identité est déduite au moment de la vérification, à partir du
// "credential_id" que l'appareil renvoie.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  try {
    const { rpID } = getRpConfig(req);
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
    await storeChallenge(supabase, options.challenge);
    return res.status(200).json(options);
  } catch (err) {
    console.error('[Webauthn login options]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
