const { getSupabase } = require('./_lib/supabase');
const { safeEqual, signAdminUserToken } = require('./_lib/auth');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

// Connexion par code personnel pour un membre de l'équipe (Module 7, Partie
// 31) — même principe que transporteur-login.js. Le mot de passe historique
// partagé continue de fonctionner via /api/admin-login (voir aussi le champ
// "code personnel" sur l'écran de connexion admin).
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const pin = ((req.body || {}).pin || '').trim();
  if (!pin) return res.status(400).json({ error: 'Code manquant' });
  if (!process.env.TRANSPORTEUR_SECRET) {
    console.error('[Admin user login] TRANSPORTEUR_SECRET manquant');
    return res.status(500).json({ error: 'Erreur serveur' });
  }

  const supabase = getSupabase();
  const rateKey = `admin-user:${getClientIp(req)}`;

  try {
    if (await isRateLimited(supabase, rateKey)) {
      return res.status(429).json({ error: 'Trop de tentatives, réessaie plus tard' });
    }

    const { data, error } = await supabase.from('admin_users').select('id, nom, pin, role').eq('actif', true);
    if (error) throw error;

    const match = (data || []).find(u => safeEqual(pin, u.pin || ''));
    if (!match) {
      await recordFailedAttempt(supabase, rateKey);
      return res.status(401).json({ error: 'Code incorrect' });
    }

    await supabase.from('admin_users').update({ last_login_at: new Date().toISOString() }).eq('id', match.id);

    return res.status(200).json({
      token: signAdminUserToken(match.id, match.pin),
      nom: match.nom,
      role: match.role,
    });
  } catch (err) {
    console.error('[Admin user login]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
