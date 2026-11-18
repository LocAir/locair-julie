// Demande de réservation Click & Collect (page /click-and-collect).
// Le client choisit un point de retrait, une durée, un jour, puis laisse
// son prénom et son téléphone : la demande part par email au propriétaire
// via Brevo, qui rappelle pour confirmer. Aucun paiement ici, aucune table
// Supabase nouvelle (rien à migrer) : même modèle que api/contact.js.
//
// Le total est RECALCULÉ ici avec le barème en base (pricing_config) : le
// chiffre envoyé par la page n'est qu'indicatif et n'est jamais repris tel
// quel, pour qu'une page modifiée ne puisse pas annoncer un faux prix.

const { getSupabase } = require('./_lib/supabase');
const { sendBrevoEmail } = require('./_lib/brevo');
const { getPricingConfig, calcTieredPrice } = require('./_lib/pricing');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);

const JOURS_MIN = 7, JOURS_MAX = 90;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  if (b.site_web) return res.json({ ok: true });            // piège anti-robots

  const d = {
    prenom:   clip(b.prenom, 60),
    tel:      clip(b.tel, 30).replace(/[^\d+]/g, ''),
    point:    clip(b.point, 120),
    ville:    clip(b.ville, 60),
    adresse:  clip(b.adresse, 200),
    exemple:  !!b.exemple,
    date:     clip(b.date, 10),
    jours:    parseInt(b.jours, 10),
    campagne: clip(b.campagne, 300),
  };

  if (!d.prenom || d.tel.replace(/\D/g, '').length < 9 || !d.point
      || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)
      || !Number.isFinite(d.jours) || d.jours < JOURS_MIN || d.jours > JOURS_MAX) {
    return res.status(400).json({ ok: false, error: 'champs' });
  }

  let sb = null;
  const ip = getClientIp(req);
  try {
    sb = getSupabase();
    if (await isRateLimited(sb, `click-collect:${ip}`, 5, 60)) {
      return res.status(429).json({ ok: false, error: 'trop' });
    }
    await recordFailedAttempt(sb, `click-collect:${ip}`);
  } catch (_e) { /* ne jamais perdre une demande pour un souci de limitation */ }

  let total = null;
  try { total = calcTieredPrice(d.jours, sb ? await getPricingConfig(sb) : undefined); }
  catch (_e) { total = calcTieredPrice(d.jours); }

  const [y, m, j] = d.date.split('-').map(Number);
  const retrait = new Date(Date.UTC(y, m - 1, j, 12));
  const retour = new Date(Date.UTC(y, m - 1, j + d.jours, 12));
  const fmt = (dt) => dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
  const telLien = d.tel.startsWith('+') ? d.tel : d.tel.replace(/^0/, '+33');

  const lignes = [
    ['Prénom', d.prenom],
    ['Téléphone', d.tel],
    ['Point de retrait', `${d.point} (${d.ville})${d.exemple ? ' — POINT D’EXEMPLE' : ''}`],
    ['Adresse affichée', d.adresse],
    ['Retrait le', fmt(retrait)],
    ['Retour le', fmt(retour)],
    ['Durée', `${d.jours} jours`],
    ['Total location', `${total.toLocaleString('fr-FR')} € (sans livraison, sans caution)`],
    ['Venu de', d.campagne || '—'],
  ].map(([k, v]) => `<tr><td style="padding:6px 12px;color:#666;white-space:nowrap">${esc(k)}</td><td style="padding:6px 12px"><b>${esc(v)}</b></td></tr>`).join('');

  const html = `
<h2 style="font-family:sans-serif;color:#1A5EDB">Click &amp; Collect — à rappeler</h2>
<p style="font-family:sans-serif;font-size:15px">Rappeler <b>${esc(d.prenom)}</b> au
<a href="tel:${esc(telLien)}">${esc(d.tel)}</a> pour confirmer l’heure du retrait.</p>
<table style="font-family:sans-serif;font-size:15px;border-collapse:collapse;margin-top:12px">${lignes}</table>
<p style="font-family:sans-serif;color:#666;font-size:13px;margin-top:16px">
  Reçue le ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} · Page /click-and-collect
</p>`;

  const r = await sendBrevoEmail({
    to: process.env.CONTACT_EMAIL || 'contact@locair.fr',
    subject: `Click & Collect — ${d.prenom} — ${d.point} — ${fmt(retrait)}`,
    html,
    senderName: 'Loc\'Air Site',
  });

  return res.status(r.ok ? 200 : 502).json({ ok: r.ok, total });
};
