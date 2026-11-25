// Prospection terrain des points de retrait : emails et SMS envoyés aux
// commerçants (après la visite, après la signature, relance du lendemain),
// et le message « avant passage » (modèle seulement, envoyé à la main
// depuis partenaires.locair@outlook.com : c'est un premier contact).
// Expéditeur technique contact@locair.fr (Brevo n'accepte pas une adresse
// outlook.com comme expéditeur) ; les réponses vont à partenaires.locair@outlook.com.
const { sendBrevoEmail, sendBrevoSms } = require('./brevo');
const { generateConventionPdf } = require('./conventionPdf');

const SITE = 'https://www.locair.fr';
const REPLY = 'partenaires.locair@outlook.com';
const TEL = '06 63 79 87 56';
const PRESENTATION = { name: 'Loc-Air-presentation-point-de-retrait.pdf', url: `${SITE}/documents/locair-devenez-point-de-retrait.pdf` };

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lienSigner = (f) => `${SITE}/partenaires?s=${encodeURIComponent(f.session_token)}&signer=1`;
const prenomDe = (s) => (String(s || '').trim().split(/\s+/)[0] || '').toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// Mise en page dans le style de la présentation commerçants (25/11/2026) :
// bandeau bleu + gros titre, « 20 % » géant en vert, cartes, un seul bouton.
const { layoutPartenaire, vingt, cartes, pieces, surtitre } = require('./emailPartenaire');

// Email 1 — après la visite, l'appel ou l'envoi rapide : présentation +
// convention pré-remplie + lien pour signer (quand il veut, sans pression).
function emailDocuments(f, { relance, interet } = {}) {
  const p = prenomDe(f.gerant || f.signataire);
  const bonjour = p ? `Bonjour ${esc(p)},` : 'Bonjour,';
  const intro = interet
    ? `${bonjour} merci pour votre intérêt. Voici la présentation et la convention.`
    : relance
      ? `${bonjour} suite à notre passage${f.enseigne ? ` chez ${esc(f.enseigne)}` : ''}, voici les deux documents.`
      : `${bonjour} merci pour notre échange. Voici les deux documents.`;
  const html = layoutPartenaire({
    preheader: '20 % de chaque location, 0 € à payer. La présentation et la convention sont jointes.',
    titre: f.enseigne ? `${esc(f.enseigne)}, devenez point de retrait.` : 'Devenez point de retrait.',
    intro,
    corps: `
      ${vingt()}
      ${cartes([
        { n: '0&nbsp;€', t: 'à payer, aucune caution', vert: true },
        { n: '7&nbsp;jours', t: 'de préavis pour arrêter' },
        { n: '10–15&nbsp;mai', t: 'dépose des climatiseurs' },
      ])}
      ${surtitre('En pièce jointe')}
      ${pieces([
        ['La présentation', '2 minutes'],
        ['La convention', f.capacite ? `pré-remplie, ${f.capacite} climatiseurs` : 'pré-remplie'],
      ])}`,
    cta: { href: lienSigner(f), label: 'Signer en ligne →' },
    note: '1 minute, sur votre téléphone. Quand vous voulez.',
  });
  return { subject: interet ? 'Merci pour votre intérêt pour Loc’Air' : `${f.enseigne ? f.enseigne + ' — ' : ''}votre point de retrait Loc’Air`, html };
}

// Email 2 — convention signée.
function emailSignee(f) {
  const p = prenomDe(f.signataire || f.gerant);
  const html = layoutPartenaire({
    preheader: 'Votre convention signée est jointe. Prochaine étape : la dépose, du 10 au 15 mai 2027.',
    eyebrow: 'Convention signée',
    titre: p ? `Merci ${esc(p)}, bienvenue chez Loc’Air.` : 'Merci, bienvenue chez Loc’Air.',
    intro: 'Votre convention signée est en pièce jointe.',
    corps: `
      ${surtitre('Prochaine étape')}
      ${cartes([
        { n: '10–15 mai', t: `dépose de ${f.capacite ? f.capacite + ' climatiseurs' : 'vos climatiseurs'}, on vous appelle avant` },
        { n: '20&nbsp;%', t: 'de chaque location, viré du 1er au 5', vert: true },
      ])}
      ${surtitre('À préparer')}
      ${pieces([['Votre SIRET', ''], ['Votre RIB', 'pour le virement de vos 20 %']]).replace(/📎/g, '✓')}`,
    cta: { href: 'https://wa.me/33663798756', label: 'Une question ? WhatsApp' },
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
async function envoyerDocuments(f, { signaturePng, relance, interet } = {}) {
  if (!f || !f.email) return { ok: false, error: 'Pas d’e-mail.' };
  const signee = !!(f.signe_at && signaturePng);
  const pdf = await generateConventionPdf(f, signee ? signaturePng : null);
  const { subject, html } = signee ? emailSignee(f) : emailDocuments(f, { relance, interet });
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
