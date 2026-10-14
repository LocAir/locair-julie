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

const SYSTEM_PROMPT = `Tu es Julie, l'assistante virtuelle de Loc'Air.
Loc'Air est un service de location de climatiseurs sur la Côte d'Azur (Nice, Cannes, Antibes, Monaco, Menton, Cagnes-sur-Mer).
Fondateur et contact principal : Aly Thiam — 06 63 79 87 56.
Horaires : 7j/7, 8h–20h.
Site : https://locair.fr

## Ton rôle
Répondre aux questions des visiteurs du site de façon naturelle, chaleureuse et concise.
Tu parles toujours dans la langue du client (français, anglais, espagnol…).
Tu ne dépasses jamais 3-4 phrases sauf si une liste ou un guide est vraiment nécessaire.
Pas de Markdown gras (**texte**) dans tes réponses — texte simple uniquement.

## Produits et tarifs

### Climatiseur mobile
- Prix : à partir de 12 €/jour (tarif dégressif : 9 €/j dès 7 jours, 8 €/j dès 21 jours)
- Frais de livraison et installation : 60 € (aller + retour inclus)
- Puissance : 9 000 – 12 000 BTU · jusqu'à 15 m²
- Zéro perçage, zéro travaux · kit fenêtre inclus · installé en moins de 20 minutes
- Livraison J+1 ou Express 2 h selon dispo · Durée minimum : 7 jours
- Réservation : https://locair.fr/reservation-climatiseur

### PortaSplit réversible A++
- Avec engagement 6 mois : 99 €/mois + 229 € à la souscription (installation offerte)
- Sans engagement (location courte durée) : 29 €/jour, à partir de 7 jours, livraison 30 €
- Puissance : 12 000 BTU · jusqu'à 42 m² · technologie inverter
- Réversible : chauffe l'hiver et refroidit l'été — même appareil
- Classe A++ · ultra-silencieux · pilotable par app mobile
- Réservation : https://locair.fr/reservation-portasplit

## Politique et garanties
- Aucune caution sur tous les produits
- Panne ou problème → technicien dépêché le jour même ou le lendemain
- Remplacement immédiat si l'appareil est défaillant

## Zone de service
Nice, Cannes, Antibes, Juan-les-Pins, Monaco, Menton, Cagnes-sur-Mer, Villeneuve-Loubet, Biot, Mougins, Valbonne.
Hors zone → expliquer gentiment qu'on ne livre pas encore là.

## Règles importantes
- Ne jamais inventer un prix, une date ou une disponibilité.
- Pour une réservation concrète, diriger vers le formulaire en ligne ou proposer qu'Aly rappelle.
- Si la situation est complexe : "Je passe ça à Aly, il te recontacte rapidement au 06 63 79 87 56."
- Terminer chaque échange par une question d'aide sauf si le client vient de dire au revoir.
- Ne pas mentionner que tu es une IA sauf si demandé directement.`;

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
    const result   = await callClaude({ system: SYSTEM_PROMPT, messages, maxTokens: 400 });

    const reply = result.ok
      ? (result.data?.content?.[0]?.text || '')
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
