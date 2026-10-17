// Webhook SMS entrant — Agent IA Loc'Air (Julie)
// Fournisseur : Twilio (numéro virtuel français avec capacité SMS entrant)
//
// Pour activer :
//   1. Créer un compte Twilio et acheter un numéro français (+33…)
//   2. Dans Twilio Console → Phone Number → Messaging webhook :
//      https://locair.fr/api/sms-inbound
//   3. Ajouter les variables d'env sur Vercel :
//      TWILIO_AUTH_TOKEN  — Token Twilio pour vérifier la signature
//      TWILIO_ACCOUNT_SID — SID Twilio
//
// ANTHROPIC_API_KEY est déjà configurée (partagée avec WhatsApp et admin-assistant).

const { getSupabase } = require('./_lib/supabase');
const { callClaude }  = require('./_lib/anthropic');
const { PRODUITS_COURT } = require('./_lib/julieKnowledge');

// Même prompt que WhatsApp (adaptation légère : "SMS" au lieu de "WhatsApp"),
// condensé pour tenir en quelques SMS — PRODUITS_COURT vient de
// _lib/julieKnowledge.js (même source que WhatsApp/web, jamais désynchronisé).
const SYSTEM_PROMPT = `Tu es Julie, l'assistante virtuelle de Loc'Air.
Loc'Air est un service de location de climatiseurs sur la Côte d'Azur (Nice, Cannes, Antibes, Monaco, Menton, Cagnes-sur-Mer).
Fondateur et contact principal : Aly Thiam — 06 63 79 87 56.
Horaires : 7j/7, 8h–20h.
Site : https://locair.fr

Tu réponds par SMS, donc sois très concise (2-3 phrases max, jamais de formatage Markdown).
Tu parles dans la langue du client.

## Produits et tarifs
${PRODUITS_COURT}
Aucune caution · panne remplacée J même · zéro travaux.

## Règles
- SMS → jamais plus de 3 phrases, jamais de liste à puces ni de gras
- Si le client signale une panne : guide-le vers 06 63 79 87 56 ou le FAQ locair.fr/#faq
- Pour une réservation, ou si le client hésite sans dire non : envoyer le lien locair.fr plutôt que juste répondre et t'arrêter là
- Si complexe ou en colère : "Aly vous rappelle rapidement au 06 63 79 87 56."
- Ne jamais inventer un prix, une disponibilité ou un avis client
- Ne pas mentionner être une IA sauf si demandé directement`;

// Table Supabase partagée avec WhatsApp (préfixe "sms:" pour distinguer)
async function loadHistory(supabase, phone) {
  try {
    const { data } = await supabase
      .from('whatsapp_conversations')
      .select('messages')
      .eq('phone', 'sms:' + phone)
      .maybeSingle();
    return data?.messages || [];
  } catch {
    return [];
  }
}

async function saveHistory(supabase, phone, messages) {
  const trimmed = messages.slice(-20);
  try {
    await supabase.from('whatsapp_conversations').upsert({
      phone:      'sms:' + phone,
      messages:   trimmed,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone' });
  } catch (e) {
    console.error('[SMS history save]', e.message);
  }
}

async function sendSmsReply(to, body) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) {
    console.warn('[SMS] Variables Twilio manquantes');
    return;
  }
  // Limiter à 320 caractères pour éviter les SMS multisegments
  const text = body.slice(0, 320);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method:  'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: text }).toString(),
  });
  if (!r.ok) console.error('[SMS send]', r.status, await r.text());
}

const handler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  // Twilio envoie en form-urlencoded
  const body   = req.body || {};
  const from   = body.From;
  const text   = (body.Body || '').trim();

  if (!from || !text) return res.status(200).send('OK');

  // Vérification de la signature Twilio
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const twilio  = require('twilio');
    const url     = `https://locair.fr/api/sms-inbound`;
    const sig     = req.headers['x-twilio-signature'] || '';
    const isValid = twilio.validateRequest(authToken, sig, url, body);
    if (!isValid) return res.status(403).send('Forbidden');
  }

  try {
    const supabase = getSupabase();
    const history  = await loadHistory(supabase, from);
    const messages = [...history, { role: 'user', content: text }];

    const result = await callClaude({ system: SYSTEM_PROMPT, messages, maxTokens: 200 });
    const reply  = result.ok
      ? (result.data?.content?.[0]?.text || '')
      : 'Problème technique. Contactez Aly au 06 63 79 87 56. Merci !';

    await saveHistory(supabase, from, [...messages, { role: 'assistant', content: reply }]);
    await sendSmsReply(from, reply);

    return res.status(200).send('OK');
  } catch (err) {
    console.error('[SMS webhook]', err.message);
    return res.status(200).send('OK');
  }
};

module.exports = handler;
