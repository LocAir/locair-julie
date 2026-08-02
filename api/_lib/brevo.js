// Délai maximum avant d'abandonner un appel Brevo — sans ça, une réponse
// lente de Brevo un jour donné peut faire traîner le cron quotidien
// (api/cron-daily.js) jusqu'à la limite de 60s de Vercel, tuant la fonction
// avant qu'elle n'atteigne les dernières sections (récap mensuel des
// virements, relance clients dormants) sans aucune trace de l'échec.
// Remonté de 12s à 20s (juillet 2026) : un SMS avec une longue URL Stripe
// pouvait prendre Brevo plus de 12s à traiter (plusieurs segments SMS), et
// notre appel abandonnait alors que le SMS finissait par partir quand même
// — Aly voyait une erreur pour un envoi en réalité réussi. 20s laisse une
// vraie marge tout en restant très inférieur à la limite de 60s de Vercel
// (aucune fonction n'appelle Brevo plusieurs fois d'affilée sans autre
// travail long entre les deux).
const BREVO_TIMEOUT_MS = 20000;

// `attachments` (optionnel) : tableau de { name, content } où content est un
// Buffer (converti en base64 ici) — utilisé pour joindre contrat/facture PDF
// (voir _lib/documents.js). Pas de limite imposée ici : Brevo plafonne à 10 Mo
// par email, largement suffisant pour deux PDF texte de quelques pages.
// `senderName` (optionnel) : nom d'expéditeur affiché au destinataire — voir
// la signature email administrable (_lib/emailEngine.js), qui lit ce nom
// depuis Supabase au lieu du nom en dur "Loc'Air" par défaut.
// Renvoie { ok: true } ou { ok: false, error } — ne jette jamais (les appels
// "best-effort" du reste du code, ex. SMS de confirmation, notifications,
// peuvent continuer à faire `await sendBrevoEmail(...)` sans se soucier du
// retour). Mais un appelant qui a besoin de savoir si l'email est VRAIMENT
// parti (ex. sendScenarioEmail dans emailEngine.js, avant de marquer une
// réservation comme "email envoyé") doit vérifier `result.ok` — sans quoi
// un échec Brevo (clé désactivée, adresse invalide, quota, panne API) était
// jusqu'ici marqué comme un envoi réussi, sans aucune trace de l'échec.
async function sendBrevoEmail({ to, subject, html, attachments, senderName }) {
  if (!process.env.BREVO_API_KEY || !to) return { ok: false, error: 'BREVO_API_KEY ou destinataire manquant' };
  try {
    const body = {
      sender:      { name: senderName || "Loc'Air", email: 'contact@locair.fr' },
      to:          [{ email: to }],
      subject,
      htmlContent: html,
    };
    if (attachments && attachments.length) {
      body.attachment = attachments.map(a => ({
        name:    a.name,
        content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
      }));
    }
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(BREVO_TIMEOUT_MS),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error('[Brevo]', r.status, detail);
      return { ok: false, error: `Brevo ${r.status} : ${detail}`.slice(0, 500) };
    }
    return { ok: true };
  } catch (e) {
    console.error('[Brevo]', e.message);
    return { ok: false, error: e.message };
  }
}

// Numéro de téléphone -> E.164, format attendu par l'API SMS de Brevo.
// Gère en priorité :
//   1. Déjà en E.164 (+xx...)
//   2. Préfixe international 00xx (ex. 0033..., 0044...)
//   3. Français local 10 chiffres commençant par 0 (06..., 07...)
//   4. Français 9 chiffres sans 0 initial
//   5. UK mobile local 11 chiffres commençant par 07 → +44
//   6. UK géographique 11 chiffres commençant par 01 ou 02 → +44
//   7. Autres formats sans 0 initial ≥ 10 chiffres (déjà avec indicatif, sans +)
//   8. Format inconnu → chaîne vide → garde "destinataire manquant" dans sendBrevoSms
function toE164FR(tel) {
  const digits = String(tel || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return '+' + digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) return '+33' + digits.slice(1);
  if (digits.length === 9 && !digits.startsWith('0')) return '+33' + digits;
  if (digits.length === 11 && digits.startsWith('07')) return '+44' + digits.slice(1);
  if (digits.length === 11 && (digits.startsWith('01') || digits.startsWith('02'))) return '+44' + digits.slice(1);
  if (!digits.startsWith('0') && digits.length >= 10) return '+' + digits;
  return '';
}

// Canal SMS distinct de l'email chez Brevo : même clé API, mais crédits et
// expéditeur (nom court, à valider dans Brevo) séparés — ne fonctionne pas
// tant que ce n'est pas explicitement activé côté compte Brevo.
// Renvoie { ok: true } ou { ok: false, error } — même contrat que
// sendBrevoEmail (voir commentaire ci-dessus). Jusqu'ici cette fonction ne
// renvoyait rien du tout : chaque appelant marquait le SMS "envoyé" sans
// aucun moyen de savoir si Brevo l'avait réellement accepté (audit
// communications, juillet 2026).
async function sendBrevoSms({ to, content }) {
  const recipient = toE164FR(to);
  if (!process.env.BREVO_API_KEY || !recipient) return { ok: false, error: 'BREVO_API_KEY ou destinataire manquant' };
  try {
    const r = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
      body:    JSON.stringify({
        sender:    process.env.BREVO_SMS_SENDER || "LocAir",
        recipient,
        content,
        type:      'transactional',
      }),
      signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error('[Brevo SMS]', r.status, detail);
      return { ok: false, error: `Brevo ${r.status} : ${detail}`.slice(0, 500) };
    }
    return { ok: true };
  } catch (e) {
    console.error('[Brevo SMS]', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendBrevoEmail, sendBrevoSms, toE164FR };
