const crypto = require('crypto');

function safeEqual(a, b) {
  try { return crypto.timingSafeEqual(Buffer.from(String(a)), Buffer.from(String(b))); } catch { return false; }
}

function checkAdminToken(req) {
  const token = ((req.body || {}).token || req.headers['x-admin-token'] || '').trim();
  return Boolean(process.env.ADMIN_PASSWORD) && safeEqual(token, process.env.ADMIN_PASSWORD);
}

// Un transporteur s'identifie par son PIN personnel (voir transporteur-login.js),
// qui lui renvoie un jeton signé `<id>.<signature>` liant définitivement ce
// jeton à SON id. Toutes les routes suivantes vérifient la signature et lisent
// l'id DANS le jeton — jamais un transporteur_id fourni tel quel par le client,
// ce qui empêche un livreur d'agir avec l'identité d'un collègue.
function signTransporteurToken(transporteurId) {
  const secret = process.env.TRANSPORTEUR_SECRET || '';
  const payload = String(transporteurId);
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyTransporteurToken(req) {
  const secret = process.env.TRANSPORTEUR_SECRET;
  if (!secret) return null;
  const token = ((req.body || {}).token || req.headers['x-transporteur-token'] || '').trim();
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (!safeEqual(sig, expected)) return null;
  const id = parseInt(payload, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

module.exports = { safeEqual, checkAdminToken, signTransporteurToken, verifyTransporteurToken };
