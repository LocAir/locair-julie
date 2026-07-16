const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Mot de passe incorrect' });
  return res.status(200).json({ ok: true, role: admin.role, nom: admin.nom });
};
