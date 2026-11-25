const { getSupabase } = require('./_lib/supabase');
const { safeEqual, signAdminUserToken } = require('./_lib/auth');
const { hashPin, verifyPin } = require('./_lib/pinHash');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

// Connexion par code personnel pour un membre de l'équipe (Module 7, Partie
// 31) — même principe que transporteur-login.js. Le mot de passe historique
// partagé continue de fonctionner via /api/admin-login (voir aussi le champ
// "code personnel" sur l'écran de connexion admin).
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const pin = String((req.body || {}).pin || '').trim();
  if (!pin) return res.status(400).json({ error: 'Code manquant' });
  if (!process.env.TRANSPORTEUR_SECRET) {
    console.error('[Admin user login] TRANSPORTEUR_SECRET manquant');
    return res.status(500).json({ error: 'Erreur serveur' });
  }

  const supabase = getSupabase();
  const rateKey = `admin-user:${getClientIp(req)}`;

  try {
    // Connexion par code seul (sans identifiant) : le code est comparé à
    // TOUS les comptes. En plus de la limite par adresse IP, une limite
    // globale empêche de deviner un code en changeant d'adresse : 30 essais
    // ratés en 15 min, toutes adresses confondues, puis pause.
    if (await isRateLimited(supabase, 'admin-user:global', 30, 15)) {
      return res.status(429).json({ error: 'Trop de tentatives, réessaie plus tard' });
    }
    if (await isRateLimited(supabase, rateKey)) {
      return res.status(429).json({ error: 'Trop de tentatives, réessaie plus tard' });
    }

    const { data, error } = await supabase.from('admin_users').select('id, nom, pin, pin_hashed, role').eq('actif', true);
    if (error) throw error;

    const match = (data || []).find(u =>
      u.pin_hashed ? verifyPin(pin, u.pin) : safeEqual(pin, u.pin || '')
    );
    if (!match) {
      await recordFailedAttempt(supabase, rateKey);
      await recordFailedAttempt(supabase, 'admin-user:global').catch(() => {});
      return res.status(401).json({ error: 'Code incorrect' });
    }

    await supabase.from('admin_users').update({ last_login_at: new Date().toISOString() }).eq('id', match.id);

    let currentPin = match.pin;
    if (!match.pin_hashed) {
      const hashed = hashPin(pin);
      const { error: migErr } = await supabase.from('admin_users')
        .update({ pin: hashed, pin_hashed: true }).eq('id', match.id);
      if (!migErr) currentPin = hashed;
      else console.error('[Admin user PIN migration]', migErr.message);
    }

    return res.status(200).json({
      token: signAdminUserToken(match.id, currentPin),
      nom: match.nom,
      role: match.role,
    });
  } catch (err) {
    console.error('[Admin user login]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
