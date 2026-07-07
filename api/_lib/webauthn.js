// rpID doit être le domaine exact (sans port ni protocole) tel que vu par le
// navigateur du transporteur. Dérivé de la requête par défaut (fonctionne
// automatiquement derrière le domaine Vercel/personnalisé) ; WEBAUTHN_RP_ID
// permet de le forcer si jamais un proxy renvoie un Host inattendu.
function getRpConfig(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return {
    rpID:   process.env.WEBAUTHN_RP_ID || host.split(':')[0],
    rpName: "Loc'Air",
    origin: `${proto}://${host}`,
  };
}

// Le challenge signé par l'appareil est encodé dans clientDataJSON — on le lit
// directement depuis la réponse plutôt que de faire confiance à un champ que le
// client pourrait renvoyer séparément.
function extractChallenge(response) {
  const clientDataJSON = response?.response?.clientDataJSON;
  if (!clientDataJSON) return null;
  try {
    return JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')).challenge;
  } catch (e) {
    return null;
  }
}

async function storeChallenge(supabase, challenge) {
  await supabase.from('webauthn_challenges').insert({ challenge });
  // Best-effort : garde la table petite, jamais bloquant.
  supabase.from('webauthn_challenges')
    .delete().lt('created_at', new Date(Date.now() - 10 * 60000).toISOString())
    .then(null, () => {});
}

// Consomme (usage unique) un challenge s'il existe et n'a pas expiré (~5 min).
async function consumeChallenge(supabase, challenge) {
  if (!challenge) return false;
  const { data } = await supabase.from('webauthn_challenges').select('id, created_at').eq('challenge', challenge).maybeSingle();
  if (!data) return false;
  await supabase.from('webauthn_challenges').delete().eq('id', data.id);
  const ageMs = Date.now() - new Date(data.created_at).getTime();
  return ageMs <= 5 * 60000;
}

module.exports = { getRpConfig, extractChallenge, storeChallenge, consumeChallenge };
