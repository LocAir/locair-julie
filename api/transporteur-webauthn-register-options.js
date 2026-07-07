const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');
const { getRpConfig, storeChallenge } = require('./_lib/webauthn');
const { generateRegistrationOptions } = require('@simplewebauthn/server');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const transporteurId = await verifyTransporteurToken(req, supabase);
  if (!transporteurId) return res.status(401).json({ error: 'Session invalide' });

  try {
    const { data: t } = await supabase.from('transporteurs').select('nom').eq('id', transporteurId).maybeSingle();
    const { data: existing } = await supabase
      .from('webauthn_credentials').select('credential_id').eq('transporteur_id', transporteurId);
    const { rpID, rpName } = getRpConfig(req);

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName:    t?.nom || `transporteur-${transporteurId}`,
      userID:      Buffer.from(String(transporteurId)),
      attestationType: 'none',
      excludeCredentials: (existing || []).map(c => ({ id: c.credential_id })),
      // "platform" = capteur intégré à l'appareil (Face ID, empreinte) plutôt
      // qu'une clé de sécurité externe. residentKey "required" = identifiant
      // stocké dans l'appareil pour permettre une connexion sans code au préalable.
      authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' },
    });

    await storeChallenge(supabase, options.challenge);
    return res.status(200).json(options);
  } catch (err) {
    console.error('[Webauthn register options]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
