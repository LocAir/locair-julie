const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { getRpConfig, storeChallenge } = require('./_lib/webauthn');
const { generateRegistrationOptions } = require('@simplewebauthn/server');

// Un seul admin (mot de passe unique) — userID fixe plutôt que dérivé d'une
// table utilisateurs qui n'existe pas pour ce rôle.
const ADMIN_USER_ID = Buffer.from('locair-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });
  // admin_webauthn_credentials est un pool partagé, non lié à un compte précis
  // (un seul mot de passe admin à l'origine, avant l'ajout des comptes équipe
  // à rôles limités) — se connecter en Face ID renvoie TOUJOURS le jeton
  // maître (accès complet), quel que soit le compte qui s'est enregistré.
  // Tant que ce n'est pas repensé (lier chaque empreinte à un compte précis,
  // nécessite un changement de schéma), seul le rôle "administrateur" peut
  // enregistrer une empreinte — sinon un compte à accès limité obtiendrait le
  // mot de passe maître au premier login Face ID.
  if (admin.role !== 'administrateur') {
    return res.status(403).json({ error: 'Face ID réservé au compte administrateur pour le moment.' });
  }

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
