// Envoi de messages WhatsApp Business (Meta Cloud API).
// Utilisé pour les messages automatiques sortants (prolongation, récupération).
//
// Variables d'env requises :
//   WHATSAPP_ACCESS_TOKEN    — System User Token permanent
//   WHATSAPP_PHONE_NUMBER_ID — ID du numéro dans Meta Business Suite
//
// ⚠️  Les messages proactifs (hors fenêtre 24h) doivent utiliser des
//     templates approuvés par Meta. Les envois libres ne fonctionnent
//     que si le client a écrit en premier dans les 24h précédentes.
//     Pour les relances automatiques (cron), un template approuvé
//     "relance_prolongation" est recommandé à terme.

async function sendWhatsappMessage(phone, body) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token   = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) {
    console.warn('[WA] WHATSAPP_PHONE_NUMBER_ID ou WHATSAPP_ACCESS_TOKEN manquant');
    return { ok: false, error: 'missing_env' };
  }

  // Découper si > 4096 caractères (limite WhatsApp)
  const chunks = [];
  for (let i = 0; i < body.length; i += 4000) chunks.push(body.slice(i, i + 4000));

  for (const chunk of chunks) {
    const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
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

// Convertit un numéro français local ("0612345678") en format WhatsApp ("33612345678").
// Passe-passe si déjà en format international.
function frToWaPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) return '33' + digits.slice(1);
  return digits;
}

module.exports = { sendWhatsappMessage, frToWaPhone };
