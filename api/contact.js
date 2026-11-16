// Formulaire de demande de devis clim fixe (page /contact).
// Envoie la demande par email à Aly via Brevo.
// Pas de table Supabase spécifique : on rate-limite par IP sur login_attempts.

const { getSupabase } = require('./_lib/supabase');
const { sendBrevoEmail } = require('./_lib/brevo');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);

const CHAMPS = [
  ['prenom',        'Prénom'],
  ['nom',           'Nom'],
  ['tel',           'Téléphone'],
  ['email',         'Email'],
  ['adresse',       'Adresse'],
  ['type_logement', 'Type de logement'],
  ['surface',       'Surface'],
  ['ext',           'Espace extérieur'],
  ['statut',        'Statut'],
];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  // Piège anti-robots
  if (b.site_web) return res.json({ ok: true });

  const d = {};
  for (const [k] of CHAMPS) d[k] = clip(b[k], 200);

  const tel = d.tel.replace(/[^\d+]/g, '');
  if (!d.prenom || !d.nom || tel.length < 9 || !d.email || !d.adresse) {
    return res.status(400).json({ ok: false, error: 'champs' });
  }

  const ip = getClientIp(req);
  try {
    const sb = getSupabase();
    if (await isRateLimited(sb, `contact:${ip}`, 5, 60)) {
      return res.status(429).json({ ok: false, error: 'trop' });
    }
    await recordFailedAttempt(sb, `contact:${ip}`);
  } catch (_e) { /* ne jamais perdre une demande pour un souci de limitation */ }

  const lignes = CHAMPS
    .filter(([k]) => d[k])
    .map(([k, label]) => `<tr><td style="padding:6px 12px;color:#666;white-space:nowrap">${esc(label)}</td><td style="padding:6px 12px"><b>${esc(d[k])}</b></td></tr>`)
    .join('');

  const html = `
<h2 style="font-family:sans-serif;color:#0E1F35">Nouvelle demande de devis — clim fixe</h2>
<table style="font-family:sans-serif;font-size:15px;border-collapse:collapse;margin-top:12px">
  ${lignes}
</table>
<p style="font-family:sans-serif;color:#666;font-size:13px;margin-top:16px">
  Reçue le ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} · Formulaire /contact
</p>`;

  const r = await sendBrevoEmail({
    to: process.env.CONTACT_EMAIL || 'contact@locair.fr',
    subject: `Devis clim fixe — ${d.nom} ${d.prenom} — ${d.adresse}`,
    html,
    replyTo: d.email,
    senderName: 'Loc\'Air Site',
  });

  return res.status(r.ok ? 200 : 502).json({ ok: r.ok });
};
