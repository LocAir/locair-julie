// Moteur commun des chatbots du site (widget /chat-widget.js) : validation,
// mémoire de conversation dans whatsapp_conversations (clé = préfixe +
// session_id), appel Claude, retrait du marqueur [ESCALADE].
// Chaque bot (api/chat.js = Julie, api/chat-joe.js = Joe) ne fournit que
// son prompt et son préfixe de mémoire.
//
// POST  →  { session_id: string, message: string }
//       ←  { reply: string }

const { getSupabase } = require('./supabase');
const { callClaude }  = require('./anthropic');

const MAX_MESSAGES = 20;
const MAX_MSG_LENGTH = 1000;

function makeChatHandler({ systemPrompt, sessionPrefix, logTag }) {
  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { session_id, message } = req.body || {};

    if (!session_id || typeof session_id !== 'string' || session_id.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(session_id))
      return res.status(400).json({ error: 'session_id invalide' });
    if (!message || typeof message !== 'string')
      return res.status(400).json({ error: 'message requis' });

    const text = message.trim().slice(0, MAX_MSG_LENGTH);
    if (!text) return res.status(400).json({ error: 'message vide' });

    try {
      const supabase = getSupabase();
      const key      = sessionPrefix + session_id;

      const { data } = await supabase
        .from('whatsapp_conversations')
        .select('messages')
        .eq('phone', key)
        .maybeSingle();

      const history  = data?.messages || [];

      // Limiter les abus : 100 messages max par session
      if (history.length >= 100) {
        return res.json({ reply: 'Cette session a atteint sa limite. Écrivez-nous directement sur WhatsApp ou appelez le 06 63 79 87 56. 🙏' });
      }

      const messages = [...history, { role: 'user', content: text }];
      const result = await callClaude({ system: systemPrompt, messages, maxTokens: 400, model: 'claude-haiku-4-5' });

      if (!result.ok) {
        console.error(`[${logTag}] callClaude failed:`, result.error);
        return res.json({ reply: 'Je rencontre un souci technique. Contactez Aly au 06 63 79 87 56. 🙏' });
      }

      const raw    = result.data?.content?.[0]?.text || '';
      const marker = '[ESCALADE]';
      const idx    = raw.indexOf(marker);
      const reply  = raw
        ? (idx !== -1 ? raw.slice(0, idx).trimEnd() : raw)
        : 'Je rencontre un souci technique. Contactez Aly au 06 63 79 87 56. 🙏';

      const trimmed = [...messages, { role: 'assistant', content: reply }].slice(-MAX_MESSAGES);
      await supabase.from('whatsapp_conversations').upsert({
        phone:      key,
        messages:   trimmed,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'phone' });

      return res.json({ reply });
    } catch (e) {
      console.error(`[${logTag}]`, e.message);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  };
}

module.exports = { makeChatHandler };
