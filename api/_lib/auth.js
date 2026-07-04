const crypto = require('crypto');

function safeEqual(a, b) {
  try { return crypto.timingSafeEqual(Buffer.from(String(a)), Buffer.from(String(b))); } catch { return false; }
}

function checkAdminToken(req) {
  const token = ((req.body || {}).token || req.headers['x-admin-token'] || '').trim();
  return Boolean(process.env.ADMIN_PASSWORD) && safeEqual(token, process.env.ADMIN_PASSWORD);
}

function checkTransporteurToken(req) {
  const token = ((req.body || {}).token || req.headers['x-transporteur-token'] || '').trim();
  return Boolean(process.env.TRANSPORTEUR_TOKEN) && safeEqual(token, process.env.TRANSPORTEUR_TOKEN);
}

module.exports = { safeEqual, checkAdminToken, checkTransporteurToken };
