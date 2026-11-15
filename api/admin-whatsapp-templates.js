// Gestion des templates WhatsApp Business (Meta Cloud API).
// Endpoint admin one-shot pour créer / lister les templates approuvés.
//
// Variables d'env requises (déjà présentes) :
//   WHATSAPP_ACCESS_TOKEN    — System User Token permanent
//   WHATSAPP_PHONE_NUMBER_ID — ID du numéro (sert à retrouver le WABA ID)
//
// Usage :
//   POST /api/admin-whatsapp-templates  { "action": "create_relance_prolongation" }
//   POST /api/admin-whatsapp-templates  { "action": "list" }

const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');

const BASE = 'https://graph.facebook.com/v20.0';

async function getToken() {
  return process.env.WHATSAPP_ACCESS_TOKEN;
}

// Récupère le WABA ID depuis le Phone Number ID (1 appel API)
async function getWabaId(token) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneId) throw new Error('WHATSAPP_PHONE_NUMBER_ID manquant');
  const r = await fetch(`${BASE}/${phoneId}?fields=whatsapp_business_account_id`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Meta API: ${JSON.stringify(data)}`);
  if (!data.whatsapp_business_account_id) throw new Error('WABA ID introuvable dans la réponse Meta');
  return data.whatsapp_business_account_id;
}

// Template FR : relance prolongation
const TEMPLATE_FR = {
  name: 'relance_prolongation',
  language: 'fr',
  category: 'UTILITY',
  components: [
    {
      type: 'BODY',
      text: 'Bonjour {{1}} 👋\n\nVotre location Loc\'Air touche à sa fin. Depuis votre espace client, en quelques clics vous pouvez :\n• Prolonger la location\n• Choisir votre créneau de récupération\n\nVotre numéro de commande : {{2}}\n\nhttps://www.locair.fr/client\n\nBonne journée !\nAly de Loc\'Air',
      example: {
        body_text: [['Thomas', 'LOC-1234']],
      },
    },
  ],
};

// Template EN : relance prolongation
const TEMPLATE_EN = {
  name: 'relance_prolongation_en',
  language: 'en',
  category: 'UTILITY',
  components: [
    {
      type: 'BODY',
      text: 'Hello {{1}} 👋\n\nYour Loc\'Air rental is ending soon. From your client space, in a few clicks you can:\n• Extend your rental\n• Choose your collection time slot\n\nYour order number: {{2}}\n\nhttps://www.locair.fr/client\n\nHave a great day!\nAly from Loc\'Air',
      example: {
        body_text: [['Thomas', 'LOC-1234']],
      },
    },
  ],
};

async function createTemplate(wabaId, token, tpl) {
  const r = await fetch(`${BASE}/${wabaId}/message_templates`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(tpl),
  });
  const data = await r.json();
  return { ok: r.ok, status: r.status, data };
}

async function listTemplates(wabaId, token) {
  const r = await fetch(`${BASE}/${wabaId}/message_templates?fields=name,status,language,category&limit=50`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await r.json();
  return { ok: r.ok, data };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });

  const action = (req.body || {}).action || 'list';

  try {
    const token = await getToken();
    if (!token) return res.status(500).json({ error: 'WHATSAPP_ACCESS_TOKEN manquant' });

    const wabaId = await getWabaId(token);

    if (action === 'list') {
      const result = await listTemplates(wabaId, token);
      return res.status(result.ok ? 200 : 502).json({ wabaId, ...result.data });
    }

    if (action === 'create_relance_prolongation') {
      const [resFr, resEn] = await Promise.all([
        createTemplate(wabaId, token, TEMPLATE_FR),
        createTemplate(wabaId, token, TEMPLATE_EN),
      ]);
      return res.status(200).json({
        wabaId,
        fr: resFr,
        en: resEn,
        message: resFr.ok && resEn.ok
          ? 'Templates soumis à Meta — validation sous 24-48h. Vérifiez le statut avec action:"list".'
          : 'Un ou plusieurs templates ont échoué — voir les détails ci-dessus.',
      });
    }

    return res.status(400).json({ error: 'action inconnue', actions_disponibles: ['list', 'create_relance_prolongation'] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
