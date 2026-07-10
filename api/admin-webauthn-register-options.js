const { getSupabase } = require('./_lib/supabase');
const { checkAdminToken } = require('./_lib/auth');
const { getRpConfig, storeChallenge } = require('./_lib/webauthn');
const { generateRegistrationOptions } = require('@simplewebauthn/server');

// Un seul admin (mot de passe unique) — userID fixe plutôt que dérivé d'une
// table utilisateurs qui n'existe pas pour ce rôle.
const ADMIN_USER_ID = Buffer.from('locair-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  try {
    const { data: existing } = await supabase.from('admin_webauthn_credentials').select('credential_id');
    const { rpID, rpName } = getRpConfig(req);

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName:    "Aly (admin Loc'Air)",
      userID:      ADMIN_USER_ID,
      attestationType: 'none',
      excludeCredentials: (existing || []).map(c => ({ id: c.credential_id })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' },
    });

    await storeChallenge(supabase, options.challenge);
    return res.status(200).json(options);
  } catch (err) {
    console.error('[Admin webauthn register options]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
