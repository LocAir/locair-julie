// Page /parrainage (lien de parrainage de l'espace partenaire) : demande de
// rappel très courte (commerce, nom, téléphone). Elle déclenche le
// parrainage ; si le commerçant signe ensuite, le parrainage est activé :
// la 1re location du nouveau point est reversée à 100 % au parrain ET à
// 100 % au nouveau commerçant (à verser à la main, voir CLAUDE.md).
// Pas de table : email à Loc'Air + notification admin.
const { getSupabase } = require('./_lib/supabase');
const { sendBrevoEmail } = require('./_lib/brevo');
const { pushToAdmin } = require('./_lib/push');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  if (b.site_web) return res.json({ ok: true }); // piège anti-robots
  const d = { commerce: clip(b.commerce, 120), nom: clip(b.nom, 120), tel: clip(b.tel, 30), parrain: clip(b.parrain, 120) };
  if (!d.commerce || !d.nom || d.tel.replace(/\D/g, '').length < 9) {
    return res.status(400).json({ ok: false, error: 'Il manque une information.' });
  }
  const supabase = getSupabase();
  try {
    const ip = getClientIp(req);
    if (await isRateLimited(supabase, `parrainage:${ip}`, 5, 60)) return res.status(429).json({ ok: false, error: 'Trop d’envois. Appelez le 06 63 79 87 56.' });
    await recordFailedAttempt(supabase, `parrainage:${ip}`);
  } catch (_e) { /* ne jamais perdre une demande pour un souci de limitation */ }

  const r = await sendBrevoEmail({
    to: process.env.CONTACT_EMAIL || 'contact@locair.fr',
    subject: `À rappeler — ${d.commerce}${d.parrain ? ` (parrainé par ${d.parrain})` : ''}`,
    html: `<div style="font-family:Arial,sans-serif;color:#0E1726;max-width:560px">
<h2 style="color:#1A5EDB;margin:0 0 8px">Demande de rappel — futur point de retrait</h2>
<table style="font-size:15px;border-collapse:collapse;margin:12px 0">
<tr><td style="padding:6px 12px 6px 0;color:#4B5873">Commerce</td><td><b>${esc(d.commerce)}</b></td></tr>
<tr><td style="padding:6px 12px 6px 0;color:#4B5873">Nom</td><td><b>${esc(d.nom)}</b></td></tr>
<tr><td style="padding:6px 12px 6px 0;color:#4B5873">Téléphone</td><td><b><a href="tel:${esc(d.tel.replace(/[^\d+]/g, ''))}">${esc(d.tel)}</a></b></td></tr>
<tr><td style="padding:6px 12px 6px 0;color:#4B5873">Parrain</td><td><b>${esc(d.parrain || '—')}</b></td></tr>
</table>
${d.parrain ? `<p><b>Parrainage déclenché.</b> S’il signe : sa 1re location est reversée à 100 % à ${esc(d.parrain)} ET à 100 % à lui (à verser à la main).</p>` : ''}
<p style="color:#4B5873;font-size:13px">Reçu le ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} · locair.fr/parrainage</p></div>`,
    senderName: "Loc'Air Site",
  });
  pushToAdmin(supabase, { title: `📞 À rappeler — ${d.commerce}`, body: `${d.nom} · ${d.tel}${d.parrain ? ` · parrainé par ${d.parrain}` : ''}`, tag: `parrainage-${Date.now()}` }).catch(() => {});
  if (!r.ok) return res.status(502).json({ ok: false, error: 'L’envoi n’a pas marché. Appelez le 06 63 79 87 56.' });
  return res.status(200).json({ ok: true });
};
