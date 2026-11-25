// Prospection terrain des points de retrait : emails et SMS envoyés aux
// commerçants (après la visite, après la signature, relance du lendemain),
// et le message « avant passage » (modèle seulement, envoyé à la main
// depuis partenaires.locair@outlook.com : c'est un premier contact).
// Expéditeur technique contact@locair.fr (Brevo n'accepte pas une adresse
// outlook.com comme expéditeur) ; les réponses vont à partenaires.locair@outlook.com.
const { sendBrevoEmail, sendBrevoSms } = require('./brevo');
const { wrap } = require('./emailTemplates');
const { generateConventionPdf } = require('./conventionPdf');

const SITE = 'https://www.locair.fr';
const REPLY = 'partenaires.locair@outlook.com';
const TEL = '06 63 79 87 56';
const PRESENTATION = { name: 'Loc-Air-presentation-point-de-retrait.pdf', url: `${SITE}/documents/locair-devenez-point-de-retrait.pdf` };

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lienSigner = (f) => `${SITE}/partenaires?s=${encodeURIComponent(f.session_token)}&signer=1`;
const prenomDe = (s) => (String(s || '').trim().split(/\s+/)[0] || '').toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// Trois chiffres, une ligne chacun (ADN Loc'Air : le moins de mots possible).
const chiffres = () => {
  const c = (n, t) => `<td width="33%" align="center" style="padding:14px 6px;background:#EFF4FD;border-radius:14px"><div style="font-size:26px;font-weight:900;color:#1A5EDB;line-height:1">${n}</div><div style="font-size:12.5px;color:#4B5873;margin-top:6px;line-height:1.3">${t}</div></td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="6" border="0" style="margin:4px 0 18px;border-collapse:separate"><tr>${c('20&nbsp;%', 'de chaque location, viré entre le 1er et le 5')}${c('0&nbsp;€', 'à encaisser, aucune caution')}${c('7&nbsp;jours', 'de préavis pour arrêter')}</tr></table>`;
};
const contact = `<p style="font-size:13px;color:#4B5873;margin:18px 0 0">Une question : ${TEL} · <a href="mailto:${REPLY}" style="color:#1A5EDB">${REPLY}</a></p>`;

// Email 1 — après la visite ou l'appel : présentation + convention pré-remplie + lien pour signer.
function emailDocuments(f, { relance } = {}) {
  const p = prenomDe(f.gerant || f.signataire);
  const html = wrap({
    title: p ? `Bonjour ${esc(p)},` : 'Bonjour,',
    intro: relance
      ? `Suite à notre passage chez ${esc(f.enseigne || 'vous')} : voici les deux documents.`
      : 'Merci pour notre échange. Voici les deux documents.',
    bodyHtml: `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">
        <tr><td style="padding:4px 10px 4px 0;font-size:18px">📎</td><td style="font-size:15px"><b>La présentation</b> — 2 minutes de lecture</td></tr>
        <tr><td style="padding:4px 10px 4px 0;font-size:18px">📎</td><td style="font-size:15px"><b>La convention</b>${f.capacite ? ` — pré-remplie, ${f.capacite} climatiseurs` : ' — pré-remplie'}</td></tr>
      </table>
      ${chiffres()}
      <p style="font-size:15px;margin:0">Pour signer : 1 minute, sur votre téléphone.</p>
      ${contact}`,
    ctaHref: lienSigner(f), ctaLabel: 'Signer en ligne',
  });
  return { subject: `${f.enseigne ? f.enseigne + ' — ' : ''}votre point de retrait Loc’Air`, html };
}

// Email 2 — convention signée.
function emailSignee(f) {
  const p = prenomDe(f.signataire || f.gerant);
  const html = wrap({
    title: p ? `Merci ${esc(p)} !` : 'Merci !',
    intro: 'Votre convention est signée. Elle est en pièce jointe.',
    bodyHtml: `
      <div class="box"><span class="lbl">Prochaine étape</span><p class="ref">Dépose du 10 au 15 mai 2027</p><p style="margin:6px 0 0;font-size:14px;color:#4B5873">${f.capacite ? `${f.capacite} climatiseurs` : 'Vos climatiseurs'}, sous housse bleue. On vous appelle avant.</p></div>
      <p style="font-size:14px;color:#4B5873;margin:0">À préparer : votre SIRET et votre RIB (pour le virement de vos 20 %).</p>
      ${contact}`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Une question ? WhatsApp',
  });
  return { subject: `${f.enseigne ? f.enseigne + ' — ' : ''}convention Loc’Air signée`, html };
}

// SMS — relance du lendemain (un seul, jamais deux).
function smsRelance(f) {
  return `Loc'Air : suite à notre passage${f.enseigne ? ' chez ' + f.enseigne : ''}, la présentation et la convention (1 min) : ${lienSigner(f)} - Question : ${TEL}. STOP pour ne plus recevoir.`;
}

// Message « avant passage » (premier contact) — modèle à copier, envoyé à la
// main depuis partenaires.locair@outlook.com. Jamais envoyé par le site.
const MODELE_AVANT_PASSAGE = {
  objet: 'Passage Loc’Air cette semaine à [Quartier / Ville] — places partenaires limitées',
  texte: [
    'Bonjour [Nom / Équipe de l’enseigne],',
    '',
    'Je passe dans votre quartier ([Quartier / Ville]) ces prochains jours pour finaliser le réseau Loc’Air : des climatiseurs mobiles en location, à retirer chez un commerçant du quartier (Click & Collect). Dépose entre le 10 et le 15 mai.',
    '',
    'Le réseau est limité à 8 à 10 commerces entre Nice et Cannes, un seul par quartier :',
    '• 20 % de chaque location, 0 € à payer, rien à encaisser, aucune caution.',
    '• 3 à 5 appareils sous housse bleue unie, gaine au-dessus. Entretien par notre agent tous les 10 jours.',
    '',
    'Si vous avez la place, répondez à ce message ou appelez-moi au 06 63 79 87 56.',
    '',
    'À très vite,',
    'Loc’Air — partenaires.locair@outlook.com · 06 63 79 87 56',
    'Vous ne souhaitez plus recevoir nos messages ? Répondez « stop ».',
  ].join('\n'),
};

// Envoie la présentation + la convention (pré-remplie, ou signée) au commerçant.
async function envoyerDocuments(f, { signaturePng, relance } = {}) {
  if (!f || !f.email) return { ok: false, error: 'Pas d’e-mail.' };
  const signee = !!(f.signe_at && signaturePng);
  const pdf = await generateConventionPdf(f, signee ? signaturePng : null);
  const { subject, html } = signee ? emailSignee(f) : emailDocuments(f, { relance });
  const nomConv = `Convention-Loc-Air-${String(f.enseigne || 'point-de-retrait').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}${signee ? '-signee' : ''}.pdf`;
  return sendBrevoEmail({
    to: f.email, subject, html, replyTo: REPLY, senderName: 'Loc’Air Partenaires',
    attachments: [PRESENTATION, { name: nomConv, content: pdf }],
  });
}

async function envoyerSmsRelance(f) {
  if (!f || !f.tel) return { ok: false, error: 'Pas de téléphone.' };
  return sendBrevoSms({ to: f.tel, content: smsRelance(f) });
}

module.exports = { envoyerDocuments, envoyerSmsRelance, emailDocuments, emailSignee, smsRelance, lienSigner, MODELE_AVANT_PASSAGE, PRESENTATION };
