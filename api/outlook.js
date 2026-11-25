// Relier la boîte Outlook partenaires au site (25/11/2026).
// - POST { token, action: 'etat' }  → Outlook relié ou non (admin).
// - POST { token, action: 'lien' }  → adresse de la page de connexion
//   Microsoft (gérant seulement). L'admin y est envoyé.
// - GET  ?code=…&state=…            → retour de Microsoft : on garde le jeton,
//   puis retour à l'admin avec ?outlook=ok (ou ?outlook=erreur).
// - POST { token, action: 'test' }  → e-mail d'essai envoyé à la boîte
//   partenaires elle-même, depuis Outlook.
const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const outlook = require('./_lib/outlook');

const VALIDITE_MS = 15 * 60 * 1000;

function signer(ts) {
  return crypto.createHmac('sha256', process.env.MS_CLIENT_SECRET || '').update(`outlook:${ts}`).digest('hex').slice(0, 32);
}

function stateValide(state) {
  const [ts, sig] = String(state || '').split('.');
  if (!ts || !sig || !/^\d+$/.test(ts)) return false;
  if (Date.now() - Number(ts) > VALIDITE_MS) return false;
  const attendu = signer(ts);
  return sig.length === attendu.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(attendu));
}

function retourAdmin(res, statut, msg) {
  const q = new URLSearchParams({ outlook: statut });
  if (msg) q.set('msg', String(msg).slice(0, 200));
  res.writeHead(302, { Location: `/admin/?${q}` });
  res.end();
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const { code, state, error, error_description } = req.query || {};
    if (error) return retourAdmin(res, 'erreur', error_description || error);
    if (!code || !stateValide(state)) return retourAdmin(res, 'erreur', 'Lien expiré : recommencez depuis l’admin.');
    try {
      await outlook.relier(String(code), getSupabase());
      return retourAdmin(res, 'ok');
    } catch (e) {
      console.error('[outlook] relier', e.message);
      return retourAdmin(res, 'erreur', e.message);
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const supabase = getSupabase();
  const auth = await checkAdminRole(req, supabase);
  if (!auth.ok) return res.status(401).json({ error: 'Non autorisé' });
  const action = String((req.body || {}).action || 'etat');

  if (action === 'etat') return res.json({ ok: true, ...(await outlook.etat(supabase)), boite: outlook.BOITE });

  if (auth.role !== 'administrateur') return res.status(403).json({ error: 'Réservé au gérant.' });

  if (action === 'lien') {
    if (!outlook.configure()) return res.status(400).json({ error: 'Il manque MS_CLIENT_ID et MS_CLIENT_SECRET dans Vercel.' });
    const ts = String(Date.now());
    return res.json({ ok: true, url: outlook.lienConnexion(`${ts}.${signer(ts)}`) });
  }

  if (action === 'test') {
    const r = await outlook.sendOutlookEmail({
      to: outlook.BOITE,
      subject: 'Essai : le site envoie bien depuis Outlook',
      html: '<p>Bonjour,</p><p>Cet e-mail est parti du site locair.fr, depuis votre boîte Outlook partenaires. Tout marche.</p><p>Loc’Air</p>',
    });
    return res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true } : { error: r.error });
  }

  return res.status(400).json({ error: 'Action inconnue' });
};
