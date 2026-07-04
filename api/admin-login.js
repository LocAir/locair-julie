const { checkAdminToken } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkAdminToken(req)) return res.status(401).json({ error: 'Mot de passe incorrect' });
  return res.status(200).json({ ok: true });
};
