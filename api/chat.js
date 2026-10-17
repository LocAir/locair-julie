// Agent chat web — Julie (widget sur locair.fr)
// Même agent que WhatsApp, adapté pour le chat web en temps réel.
//
// POST /api/chat  →  { session_id: string, message: string }
//                 ←  { reply: string }
//
// session_id : UUID généré côté client (localStorage), max 64 chars
// Mémoire stockée dans whatsapp_conversations avec préfixe "web:"

const { getSupabase } = require('./_lib/supabase');
const { callClaude }  = require('./_lib/anthropic');
const { IDENTITY, PRODUITS, GARANTIES, ZONE, DEPANNAGE, TECHNIQUE_VENTE, ESCALADE_10 } = require('./_lib/julieKnowledge');

const SYSTEM_PROMPT = `Tu es Julie, l'assistante virtuelle de Loc'Air.
${IDENTITY}

## Ton rôle
Répondre aux questions des visiteurs du site de façon naturelle, chaleureuse et concise.
Tu parles toujours dans la langue du client (français, anglais, espagnol…).
Tu ne dépasses jamais 3-4 phrases sauf si une liste ou un guide est vraiment nécessaire.
Pas de Markdown gras (**texte**) dans tes réponses — texte simple uniquement.

## Produits et tarifs

${PRODUITS}

## Politique et garanties
${GARANTIES}

## Guide de dépannage rapide (à utiliser si le visiteur signale un problème sur un appareil déjà loué)
${DEPANNAGE}

## Zone de service
${ZONE}

## Technique de vente
${TECHNIQUE_VENTE}
Contrairement à WhatsApp/SMS, tu ne connais pas encore les coordonnées du visiteur ici. Si l'échange est engagé (il a posé plusieurs questions concrètes) mais n'aboutit pas tout de suite à une réservation, propose-lui — sans jamais forcer — de laisser un numéro ou un email pour qu'Aly le recontacte.

## Règles importantes
- Ne jamais inventer un prix, une date, une disponibilité ou un avis client : si tu n'es pas sûre, dis que tu vas vérifier avec l'équipe.
- Pour une réservation concrète, diriger vers le formulaire en ligne ou proposer qu'Aly rappelle.
- Ne pas mentionner que tu es une IA sauf si demandé directement.

## Quand escalader à Aly — OBLIGATOIRE dans ces 10 situations

Dans chacun de ces cas : réponds avec empathie, rassure le visiteur ("je transmets ça à Aly en priorité, il te recontacte rapidement au 06 63 79 87 56"), puis termine ta réponse par [ESCALADE].

${ESCALADE_10}`;

const MAX_MESSAGES = 20;
const MAX_MSG_LENGTH = 1000;

module.exports = async (req, res) => {
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
    const key      = 'web:' + session_id;

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
    const result = await callClaude({ system: SYSTEM_PROMPT, messages, maxTokens: 400, model: 'claude-haiku-4-5' });

    if (!result.ok) {
      console.error('[chat] callClaude failed:', result.error);
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
    console.error('[chat]', e.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
