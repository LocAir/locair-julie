// Page /contrat-point-retrait : un commerçant crée son contrat de point de
// retrait (lien de la dernière diapo de la présentation commerçants).
// Pas de table : la demande part par email à Loc'Air (+ notification admin),
// et le commerçant reçoit un récapitulatif. Loc'Air lui envoie ensuite le
// convention à signer (sur papier, en rendez-vous). Seules les conditions déjà décidées sont écrites
// (20 %, virement mensuel, entretien mensuel, nombre d'appareils selon la
// place, reprise des appareils l'hiver, vol ou casse payés par Loc'Air,
// sans engagement).
const { getSupabase } = require('./_lib/supabase');
const { sendBrevoEmail } = require('./_lib/brevo');
const { pushToAdmin } = require('./_lib/push');
const { wrap } = require('./_lib/emailTemplates');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// « MARIE CORNIGLIONE » → « Marie » ; « jean-pierre dupont » → « Jean-Pierre »
// Lettres, tiret et apostrophe seulement (30 max) : le prénom va dans l'objet
// d'un e-mail envoyé à l'adresse tapée, jamais une adresse web ou un message.
const prenomPropre = (s) => (String(s || '').trim().split(/\s+/)[0] || '').replace(/[^\p{L}'’-]/gu, '').slice(0, 30).toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) || 'et bienvenue';
// Texte simple : pas d'objet (« [object Object] »), pas de retour à la ligne (sujet d'email).
const clip = (s, n) => (typeof s === 'string' || typeof s === 'number' ? String(s) : '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);

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
  ['parrain', 'Recommandé par (parrainage : 50 € au parrain ET 50 € au nouveau commerçant)', 120],
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
  // Climatiseurs : 1 à 10 (le formulaire propose 2 à 10), sinon 4.
  const nb = Number(d.appareils);
  d.appareils = /^\d{1,2}$/.test(d.appareils) && nb >= 1 && nb <= 10 ? String(nb) : '4';
  // Démarrage : une vraie date, pas dans le passé (heure de Paris), sinon rien.
  const auj = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d.debut) ? new Date(d.debut + 'T12:00:00Z') : null;
  if (!dt || isNaN(dt) || dt.toISOString().slice(0, 10) !== d.debut || d.debut < auj) d.debut = '';

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
<p>${esc(d.gerant)} veut ouvrir un point de retrait. À faire : l’appeler, passer signer la convention (papier, 2 exemplaires), puis suivre « Ouvrir un nouveau point » (admin → Points de retrait).</p>
${table}
<p style="color:#4B5873;font-size:13px">Reçu le ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} · locair.fr/contrat-point-retrait</p></div>`,
    senderName: "Loc'Air Site",
  });
  pushToAdmin(supabase, { title: `🏪 Nouveau point de retrait — ${d.commerce}`, body: `${d.gerant} · ${d.ville} · ${d.tel}`, tag: `contrat-pr-${Date.now()}` }).catch(() => {});
  if (!admin.ok) return res.status(502).json({ ok: false, error: 'L’envoi n’a pas marché. Réessayez ou appelez le 06 63 79 87 56.' });

  // 2. Au commerçant : le récapitulatif, au style des emails clients (wrap).
  // Peu de mots : la prochaine étape, 3 chiffres, ce qui est compris, sa demande.
  const prenom = prenomPropre(d.gerant);
  const debutTxt = d.debut ? new Date(d.debut + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(/^1 /, '1er ') : '';
  const chiffre = (n, t) => `<td width="33%" align="center" style="padding:14px 6px;background:#EFF4FD;border-radius:14px"><div style="font-size:26px;font-weight:900;color:#1A5EDB;line-height:1;letter-spacing:-.02em">${n}</div><div style="font-size:12.5px;color:#4B5873;margin-top:6px;line-height:1.3">${t}</div></td>`;
  const coche = (t) => `<tr><td valign="top" style="padding:5px 10px 5px 0;color:#0F7A3D;font-weight:900;font-size:15px">✓</td><td style="padding:5px 0;font-size:15px;line-height:1.45">${t}</td></tr>`;
  const ligne = (k, v) => v ? `<tr><td valign="top" style="padding:5px 14px 5px 0;color:#4B5873;font-size:14px;white-space:nowrap">${k}</td><td style="padding:5px 0;font-size:14px;font-weight:700">${esc(v)}</td></tr>` : '';
  const html = wrap({
    title: `Merci ${esc(prenom)} !`,
    intro: 'Votre demande de point de retrait est bien reçue.',
    bodyHtml: `
      <div class="box"><span class="lbl">Prochaine étape</span><p class="ref">On vous appelle.</p><p style="margin:6px 0 0;font-size:14px;color:#4B5873">On passe chez vous signer la convention, sur papier. Prévoyez votre SIRET et votre RIB.</p></div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="6" border="0" style="margin:4px 0 18px;border-collapse:separate"><tr>
        ${chiffre('20&nbsp;%', 'de chaque location, viré entre le 1er et le 5 du mois')}${chiffre('0&nbsp;€', 'à encaisser : le client paie en ligne')}${chiffre('0', 'engagement : vous arrêtez quand vous voulez')}
      </tr></table>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px">
        ${coche('Entretien par notre agent tous les 10 jours.')}
        ${coche('Dépose des climatiseurs du 10 au 15 mai, reprise fin septembre.')}
        ${coche('Vol ou casse en boutique : Loc’Air paie.')}
        ${coche('Seul point de votre quartier : le premier qui signe a l’exclusivité.')}
        ${coche('Parrainage : 50 € pour vous et 50 € pour le commerçant que vous recommandez, virés après sa 1re location.')}
      </table>
      <p style="font-size:14px;color:#4B5873;margin:0 0 18px">Saison 2027 : <b style="color:#0E1726">fin mai à fin septembre</b>. Arrêt possible à tout moment, avec 7 jours de préavis.</p>
      <span class="lbl">Votre demande</span>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0">
        ${ligne('Commerce', d.commerce)}${ligne('Adresse', `${d.adresse}, ${d.cp} ${d.ville}`)}${ligne('Horaires', d.horaires)}${ligne('Climatiseurs', d.appareils)}${ligne('Démarrage', debutTxt)}
      </table>
      <p style="font-size:13px;color:#4B5873;margin:18px 0 0">Une question : 06 63 79 87 56 · <a href="mailto:partenaires.locair@outlook.com" style="color:#1A5EDB">partenaires.locair@outlook.com</a></p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Une question ? WhatsApp',
    // contact des commerçants (convention) : affiché sous le bouton
  });
  // Au plus 2 confirmations par jour vers une même adresse (toutes adresses IP
  // confondues) : le formulaire ne doit pas servir à écrire à des inconnus.
  const cleMail = `contrat-pr-mail:${String(d.email || '').toLowerCase().slice(0, 120)}`;
  const tropDeMails = await isRateLimited(supabase, cleMail, 2, 1440).catch(() => false);
  if (!tropDeMails) await recordFailedAttempt(supabase, cleMail).catch(() => {});
  if (!tropDeMails) await sendBrevoEmail({ to: d.email, subject: `${prenom}, votre point de retrait Loc’Air`, html, senderName: "Loc'Air", replyTo: 'partenaires.locair@outlook.com' }).catch(() => {});

  return res.status(200).json({ ok: true });
};
