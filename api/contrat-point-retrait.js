// Page /contrat-point-retrait : un commerçant crée son contrat de point de
// retrait (lien de la dernière diapo de la présentation commerçants).
// Pas de table : la demande part par email à Loc'Air (+ notification admin),
// et le commerçant reçoit un récapitulatif. Loc'Air lui envoie ensuite le
// contrat à signer. Seules les conditions déjà décidées sont écrites
// (20 %, virement mensuel, entretien mensuel, nombre d'appareils selon la
// place, hiver au choix, vol ou casse payés par Loc'Air sauf faute grave,
// sans engagement).
const { getSupabase } = require('./_lib/supabase');
const { sendBrevoEmail } = require('./_lib/brevo');
const { pushToAdmin } = require('./_lib/push');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);

const CHAMPS = [
  ['commerce', 'Commerce', 120],
  ['gerant', 'Gérant', 120],
  ['tel', 'Téléphone', 30],
  ['email', 'Email', 160],
  ['adresse', 'Adresse', 200],
  ['cp', 'Code postal', 5],
  ['ville', 'Ville', 80],
  ['horaires', 'Horaires', 160],
  ['appareils', 'Climatiseurs à garder', 3],
  ['debut', 'Démarrage souhaité', 10],
  ['hiver', 'L’hiver', 20],
];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  if (b.site_web) return res.json({ ok: true }); // piège anti-robots

  const d = {};
  for (const [k, , n] of CHAMPS) d[k] = clip(b[k], n);
  const telOk = d.tel.replace(/\D/g, '').length >= 9;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email);
  if (!d.commerce || !d.gerant || !telOk || !emailOk || !d.adresse || !/^\d{5}$/.test(d.cp) || !d.ville || !d.horaires) {
    return res.status(400).json({ ok: false, error: 'Il manque une information.' });
  }
  if (!/^\d{1,2}$/.test(d.appareils)) d.appareils = '4';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.debut)) d.debut = '';
  d.hiver = d.hiver === 'garde' ? 'Il les garde chez lui' : 'Loc’Air les reprend jusqu’au printemps';

  const supabase = getSupabase();
  try {
    const ip = getClientIp(req);
    if (await isRateLimited(supabase, `contrat-pr:${ip}`, 5, 60)) return res.status(429).json({ ok: false, error: 'Trop d’envois. Appelez le 06 63 79 87 56.' });
    await recordFailedAttempt(supabase, `contrat-pr:${ip}`);
  } catch (_e) { /* ne jamais perdre une demande pour un souci de limitation */ }

  const lignes = CHAMPS.filter(([k]) => d[k])
    .map(([k, label]) => `<tr><td style="padding:6px 12px 6px 0;color:#4B5873;white-space:nowrap">${esc(label)}</td><td style="padding:6px 0"><b>${esc(d[k])}</b></td></tr>`).join('');
  const table = `<table style="font-size:15px;border-collapse:collapse;margin:12px 0">${lignes}</table>`;

  // 1. À Loc'Air : la demande complète, pour préparer le contrat.
  const admin = await sendBrevoEmail({
    to: process.env.CONTACT_EMAIL || 'contact@locair.fr',
    subject: `Nouveau point de retrait — ${d.commerce} (${d.ville})`,
    html: `<div style="font-family:Arial,sans-serif;color:#0E1726;max-width:560px">
<h2 style="color:#1A5EDB;margin:0 0 8px">Contrat point de retrait à envoyer</h2>
<p>${esc(d.gerant)} veut ouvrir un point de retrait. À faire : l’appeler, envoyer le contrat à signer, puis suivre « Ouvrir un nouveau point » (admin → Points de retrait).</p>
${table}
<p style="color:#4B5873;font-size:13px">Reçu le ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} · locair.fr/contrat-point-retrait</p></div>`,
    senderName: "Loc'Air Site",
  });
  pushToAdmin(supabase, { title: `🏪 Nouveau point de retrait — ${d.commerce}`, body: `${d.gerant} · ${d.ville} · ${d.tel}`, tag: `contrat-pr-${Date.now()}` }).catch(() => {});
  if (!admin.ok) return res.status(502).json({ ok: false, error: 'L’envoi n’a pas marché. Réessayez ou appelez le 06 63 79 87 56.' });

  // 2. Au commerçant : le récapitulatif.
  await sendBrevoEmail({
    to: d.email,
    subject: 'Votre point de retrait Loc’Air',
    html: `<div style="font-family:Arial,sans-serif;color:#0E1726;max-width:560px">
<h2 style="color:#1A5EDB;margin:0 0 12px">Merci ${esc(d.gerant)} !</h2>
<p>On vous appelle pour fixer le dépôt des climatiseurs. Le contrat à signer suit par email.</p>
<ul style="padding-left:18px;line-height:1.6">
<li><b>20 %</b> de chaque location, viré chaque mois.</li>
<li>Le client paie en ligne : rien à encaisser.</li>
<li>Entretien des climatiseurs une fois par mois (plus souvent en canicule).</li>
<li>Vol ou casse en boutique : Loc’Air paie, sauf faute grave de votre part.</li>
<li><b>Sans engagement</b> : vous arrêtez quand vous voulez.</li>
</ul>
${table}
<p style="color:#4B5873;font-size:13px">Loc’Air · 06 63 79 87 56 · locair.fr</p></div>`,
    senderName: "Loc'Air",
  }).catch(() => {});

  return res.status(200).json({ ok: true });
};
