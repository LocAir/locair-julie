// Demande de devis pompe à chaleur — site test « Côte Chaleur » (/pac).
// Le visiteur remplit le formulaire, on envoie la demande par email au
// propriétaire (variable DEVIS_PAC_EMAIL, sinon contact@locair.fr), qui la
// transmet ensuite à l'installateur partenaire.
// Aucune table nouvelle : on réutilise seulement `login_attempts` (déjà en
// base) pour limiter les envois répétés depuis une même adresse IP.

const { getSupabase } = require('./_lib/supabase');
const { sendBrevoEmail } = require('./_lib/brevo');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);

const CHAMPS = [
  ['projet', 'Projet'], ['logement', 'Logement'], ['surface', 'Surface (m²)'],
  ['chauffage', 'Chauffage actuel'], ['statut', 'Statut'], ['delai', 'Délai'],
  ['code_postal', 'Code postal'], ['ville', 'Page d\'origine'],
  ['nom', 'Nom'], ['telephone', 'Téléphone'], ['email', 'Email'], ['message', 'Message'],
];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  // Piège à robots : champ invisible pour un humain.
  if (b.site_web) return res.json({ ok: true });

  const d = {};
  for (const [k] of CHAMPS) d[k] = clip(b[k], k === 'message' ? 1500 : 120);

  const tel = d.telephone.replace(/[^\d+]/g, '');
  if (!d.nom || tel.length < 9 || !/^\d{5}$/.test(d.code_postal) || b.consentement !== true) {
    return res.status(400).json({ ok: false, error: 'champs' });
  }

  const ip = getClientIp(req);
  try {
    const sb = getSupabase();
    if (await isRateLimited(sb, `devis-pac:${ip}`, 5, 60)) {
      return res.status(429).json({ ok: false, error: 'trop' });
    }
    await recordFailedAttempt(sb, `devis-pac:${ip}`);
  } catch (_e) { /* ne jamais perdre une demande pour un souci de limitation */ }

  const lignes = CHAMPS
    .filter(([k]) => d[k])
    .map(([k, label]) => `<tr><td style="padding:6px 12px;color:#666">${esc(label)}</td><td style="padding:6px 12px"><b>${esc(d[k])}</b></td></tr>`)
    .join('');
  const html = `<h2 style="font-family:sans-serif">Nouvelle demande de devis — pompe à chaleur</h2>
<table style="font-family:sans-serif;font-size:15px;border-collapse:collapse">${lignes}</table>
<p style="font-family:sans-serif;color:#666;font-size:13px">Reçue le ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}. Le client a accepté d'être recontacté et que sa demande soit transmise à un installateur partenaire.</p>`;

  const r = await sendBrevoEmail({
    to: process.env.DEVIS_PAC_EMAIL || 'contact@locair.fr',
    subject: `Devis PAC — ${d.code_postal} — ${d.nom}`,
    html,
    senderName: 'Côte Chaleur',
  });
  if (!r.ok) return res.status(502).json({ ok: false, error: 'envoi' });
  return res.json({ ok: true });
};
