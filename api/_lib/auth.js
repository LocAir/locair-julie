const crypto = require('crypto');

function safeEqual(a, b) {
  try { return crypto.timingSafeEqual(Buffer.from(String(a)), Buffer.from(String(b))); } catch { return false; }
}

function checkAdminToken(req) {
  const token = ((req.body || {}).token || req.headers['x-admin-token'] || '').trim();
  return Boolean(process.env.ADMIN_PASSWORD) && safeEqual(token, process.env.ADMIN_PASSWORD);
}

// Un transporteur s'identifie par son PIN personnel (voir transporteur-login.js),
// qui lui renvoie un jeton signé `<id>.<empreinte du PIN>.<signature>`. L'empreinte
// du PIN (pas le PIN lui-même) est incluse pour que le jeton devienne invalide
// automatiquement dès que le PIN change (reset "code oublié", ou changé par
// l'admin) — sans ça, un ancien jeton resterait valable indéfiniment même après
// un changement de code. L'id est toujours lu DANS le jeton vérifié, jamais un
// transporteur_id fourni tel quel par le client, ce qui empêche un livreur
// d'agir avec l'identité d'un collègue.
function pinFingerprint(pin) {
  return crypto.createHash('sha256').update(String(pin || '')).digest('hex').slice(0, 16);
}

function signTransporteurToken(transporteurId, pin) {
  const secret  = process.env.TRANSPORTEUR_SECRET || '';
  const payload = `${transporteurId}.${pinFingerprint(pin)}`;
  const sig     = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

// Vérifie la signature ET que le PIN n'a pas changé depuis l'émission du jeton
// (nécessite une lecture en base — appelé une fois par requête, coût négligeable
// à cette échelle). Renvoie l'id transporteur authentifié, ou null.
async function verifyTransporteurToken(req, supabase) {
  const secret = process.env.TRANSPORTEUR_SECRET;
  if (!secret) return null;
  const token = ((req.body || {}).token || req.headers['x-transporteur-token'] || '').trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [idStr, fingerprint, sig] = parts;
  const payload  = `${idStr}.${fingerprint}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (!safeEqual(sig, expected)) return null;

  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id) || id <= 0) return null;

  const { data: t } = await supabase.from('transporteurs').select('pin, actif').eq('id', id).maybeSingle();
  if (!t || !t.actif || !safeEqual(fingerprint, pinFingerprint(t.pin))) return null;

  return id;
}

module.exports = { safeEqual, checkAdminToken, signTransporteurToken, verifyTransporteurToken };
