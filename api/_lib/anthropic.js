// Appel brut à l'API Claude (Anthropic) — même style que _lib/brevo.js
// (fetch direct, jamais de throw, { ok, ... } en retour) plutôt que d'ajouter
// le SDK @anthropic-ai/sdk comme dépendance pour un seul appel.
//
// Utilisé par l'Assistant IA de l'admin (_lib/assistantTools.js +
// admin-assistant.js) — nécessite la variable d'environnement
// ANTHROPIC_API_KEY sur Vercel (clé à créer sur console.anthropic.com,
// cette session n'y a pas accès). Sans elle, callClaude renvoie
// { ok:false, error } au lieu de planter — admin-assistant.js traduit ça en
// message clair pour Aly plutôt qu'une page blanche.
const ANTHROPIC_TIMEOUT_MS = 50000; // sous la limite Vercel de 60s (maxDuration, vercel.json)
const MODEL = 'claude-sonnet-5';

async function callClaude({ system, messages, tools, maxTokens = 1536 }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY n'est pas configurée sur Vercel — l'assistant ne peut pas fonctionner tant que cette clé n'est pas ajoutée (Settings → Environment Variables)." };
  }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: maxTokens,
        system,
        messages,
        tools,
      }),
      signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error('[Anthropic]', r.status, detail);
      return { ok: false, error: `Claude ${r.status} : ${detail}`.slice(0, 500) };
    }
    const data = await r.json();
    return { ok: true, data };
  } catch (e) {
    console.error('[Anthropic]', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { callClaude };
