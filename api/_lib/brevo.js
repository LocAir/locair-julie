// `attachments` (optionnel) : tableau de { name, content } où content est un
// Buffer (converti en base64 ici) — utilisé pour joindre contrat/facture PDF
// (voir _lib/documents.js). Pas de limite imposée ici : Brevo plafonne à 10 Mo
// par email, largement suffisant pour deux PDF texte de quelques pages.
async function sendBrevoEmail({ to, subject, html, attachments }) {
  if (!process.env.BREVO_API_KEY || !to) return;
  try {
    const body = {
      sender:      { name: "Loc'Air", email: 'contact@locair.fr' },
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
    });
    if (!r.ok) console.error('[Brevo]', r.status, await r.text());
  } catch (e) {
    console.error('[Brevo]', e.message);
  }
}

// Numéro français local ("0612345678") -> E.164 ("+33612345678"), format
// attendu par l'API SMS de Brevo. Les numéros déjà au format international
// sont laissés tels quels.
function toE164FR(tel) {
  const digits = String(tel || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('0') && digits.length === 10) return '+33' + digits.slice(1);
  return digits ? '+' + digits : '';
}

// Canal SMS distinct de l'email chez Brevo : même clé API, mais crédits et
// expéditeur (nom court, à valider dans Brevo) séparés — ne fonctionne pas
// tant que ce n'est pas explicitement activé côté compte Brevo.
async function sendBrevoSms({ to, content }) {
  const recipient = toE164FR(to);
  if (!process.env.BREVO_API_KEY || !recipient) return;
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
    });
    if (!r.ok) console.error('[Brevo SMS]', r.status, await r.text());
  } catch (e) {
    console.error('[Brevo SMS]', e.message);
  }
}

module.exports = { sendBrevoEmail, sendBrevoSms };
