// Envoi de messages WhatsApp Business (Meta Cloud API).
// Utilisé pour les messages automatiques sortants (prolongation, récupération).
//
// Variables d'env requises :
//   WHATSAPP_ACCESS_TOKEN    — System User Token permanent
//   WHATSAPP_PHONE_NUMBER_ID — ID du numéro dans Meta Business Suite
//
// Deux modes d'envoi :
//   sendWhatsappMessage(phone, body)        — texte libre (fenêtre 24h)
//   sendWhatsappTemplate(phone, name, lang, params) — template approuvé (toujours OK)

const BASE = 'https://graph.facebook.com/v20.0';

function getEnv() {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token   = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) return null;
  return { phoneId, token };
}

// Texte libre — uniquement dans la fenêtre de 24h après un message client
async function sendWhatsappMessage(phone, body) {
  const env = getEnv();
  if (!env) {
    console.warn('[WA] WHATSAPP_PHONE_NUMBER_ID ou WHATSAPP_ACCESS_TOKEN manquant');
    return { ok: false, error: 'missing_env' };
  }

  const chunks = [];
  for (let i = 0; i < body.length; i += 4000) chunks.push(body.slice(i, i + 4000));

  for (const chunk of chunks) {
    const r = await fetch(`${BASE}/${env.phoneId}/messages`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${env.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'text',
        text: { preview_url: false, body: chunk },
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      console.error('[WA send]', r.status, err);
      return { ok: false, error: `${r.status}: ${err}` };
    }
  }
  return { ok: true };
}

// Template approuvé — fonctionne même sans fenêtre 24h (messages proactifs).
// `params` : tableau de chaînes correspondant aux {{1}}, {{2}}… du template.
// Exemple : sendWhatsappTemplate("33612345678", "relance_prolongation", "fr", ["Thomas", "LOC-1234"])
async function sendWhatsappTemplate(phone, templateName, lang, params = []) {
  const env = getEnv();
  if (!env) {
    console.warn('[WA] WHATSAPP_PHONE_NUMBER_ID ou WHATSAPP_ACCESS_TOKEN manquant');
    return { ok: false, error: 'missing_env' };
  }

  const components = params.length > 0 ? [{
    type: 'body',
    parameters: params.map(p => ({ type: 'text', text: String(p) })),
  }] : [];

  const r = await fetch(`${BASE}/${env.phoneId}/messages`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${env.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: lang },
        ...(components.length > 0 ? { components } : {}),
      },
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    console.error('[WA template]', r.status, err);
    return { ok: false, error: `${r.status}: ${err}` };
  }
  return { ok: true };
}

// Convertit un numéro français local ("0612345678") en format WhatsApp ("33612345678").
// Passe-passe si déjà en format international.
function frToWaPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) return '33' + digits.slice(1);
  return digits;
}

module.exports = { sendWhatsappMessage, sendWhatsappTemplate, frToWaPhone };
