// Connexion à Synthesia — fabrication de vidéos avec un présentateur IA à
// partir d'un simple texte (https://docs.synthesia.io/reference/introduction).
// Le rendu est asynchrone : créer une vidéo renvoie immédiatement un
// identifiant, puis la vidéo se fabrique côté Synthesia pendant quelques
// minutes. On ne bloque donc jamais un appel HTTP en attendant le rendu —
// c'est l'appelant (l'outil en ligne de commande synthesia-generateur.js,
// ou un futur endpoint admin) qui décide comment attendre.
//
// Même contrat que _lib/brevo.js : ces fonctions ne jettent jamais, elles
// renvoient { ok: true, ... } ou { ok: false, error }. Un appel Synthesia
// qui échoue (clé révoquée, quota de crédits épuisé, avatar inconnu) ne
// doit pas faire tomber le reste du traitement.
const SYNTHESIA_BASE = 'https://api.synthesia.io/v2';

// 30s : aucun appel ici n'attend un rendu (la création répond tout de suite),
// donc 30s est déjà très large. On reste sous la limite de 60s de Vercel
// (vercel.json) pour qu'une fonction serverless qui appelle Synthesia puisse
// encore répondre proprement même quand l'API est lente.
const SYNTHESIA_TIMEOUT_MS = 30000;

// Avatar et fond utilisés quand l'appelant n'en précise pas. Modifiables sans
// toucher au code via les variables d'environnement : l'identifiant d'un
// avatar se copie depuis Synthesia (page Avatars > menu "..." > Copy ID),
// et un avatar personnalisé (une vraie personne filmée une fois) s'utilise
// exactement comme un avatar de stock.
const AVATAR_DEFAUT = process.env.SYNTHESIA_AVATAR_ID  || 'anna_costume1_cameraA';
const FOND_DEFAUT   = process.env.SYNTHESIA_BACKGROUND || 'off_white';

// Synthesia attend la clé brute dans l'en-tête Authorization, sans préfixe
// "Bearer". Si la clé brute est refusée (401) on retente une fois en
// "Bearer <clé>" : ça évite d'annoncer "clé invalide" au propriétaire pour
// une simple différence de format d'en-tête, alors que la clé est bonne.
async function appelSynthesia(methode, chemin, corps) {
  const cle = (process.env.SYNTHESIA_API_KEY || '').trim();
  if (!cle) {
    return { ok: false, error: "SYNTHESIA_API_KEY manquante — voir SYNTHESIA.md" };
  }
  const prefixes = /^Bearer\s/i.test(cle) ? [''] : ['', 'Bearer '];
  let dernier = null;
  for (const prefixe of prefixes) {
    try {
      const r = await fetch(`${SYNTHESIA_BASE}${chemin}`, {
        method: methode,
        headers: {
          Authorization: `${prefixe}${cle}`,
          'Content-Type': 'application/json',
        },
        body: corps ? JSON.stringify(corps) : undefined,
        signal: AbortSignal.timeout(SYNTHESIA_TIMEOUT_MS),
      });
      const texte = await r.text();
      let data = null;
      try { data = texte ? JSON.parse(texte) : null; } catch { /* réponse non-JSON : gardée telle quelle dans l'erreur */ }
      if (r.ok) return { ok: true, data };
      dernier = { ok: false, status: r.status, error: `Synthesia ${r.status} : ${texte}`.slice(0, 500) };
      // Seul un 401 mérite le second essai ; un 400 (script vide, avatar
      // inconnu) ou un 402 (plus de crédits) se reproduirait à l'identique.
      if (r.status !== 401) break;
    } catch (e) {
      // Timeout ou réseau coupé : inutile de retenter avec l'autre en-tête.
      return { ok: false, error: e.message };
    }
  }
  console.error('[Synthesia]', dernier && dernier.error);
  return dernier;
}

// Crée une vidéo à partir d'un texte.
// - `test: true` (le défaut) fabrique une vidéo filigranée qui ne consomme
//   aucun crédit : c'est le mode à utiliser pour tout essai. Il faut demander
//   explicitement `test: false` pour dépenser un crédit du forfait.
// - `format` : '16:9' (ordinateur), '9:16' (story/téléphone), '1:1', '4:5'.
// - `visibilite` : 'private' par défaut — une vidéo 'public' est accessible
//   à qui a le lien, ce qui n'est jamais souhaitable par défaut.
// Renvoie { ok: true, id, statut } — l'identifiant sert ensuite à suivre le
// rendu avec statutVideo(id).
async function creerVideo({ titre, texte, avatar, fond, format, test, description, visibilite } = {}) {
  const script = (texte || '').trim();
  if (!script) return { ok: false, error: 'Texte du script vide' };

  const corps = {
    test:        test !== false,
    title:       (titre || 'Vidéo Loc\'Air').slice(0, 120),
    visibility:  visibilite || 'private',
    aspectRatio: format || '16:9',
    input: [{
      scriptText: script,
      avatar:     avatar || AVATAR_DEFAUT,
      background: fond   || FOND_DEFAUT,
    }],
  };
  if (description) corps.description = String(description).slice(0, 500);

  const r = await appelSynthesia('POST', '/videos', corps);
  if (!r.ok) return r;
  const data = r.data || {};
  return { ok: true, id: data.id, statut: data.status, test: corps.test, video: data };
}

// État d'une vidéo. `statut` vaut 'in_progress' pendant le rendu, puis
// 'complete' (le lien de téléchargement apparaît alors dans `download`) ou
// 'failed'. Le lien de téléchargement est temporaire : il faut enregistrer
// le fichier, pas garder l'URL.
async function statutVideo(id) {
  if (!id) return { ok: false, error: 'Identifiant de vidéo manquant' };
  const r = await appelSynthesia('GET', `/videos/${encodeURIComponent(id)}`);
  if (!r.ok) return r;
  const data = r.data || {};
  return { ok: true, statut: data.status, download: data.download, video: data };
}

// Les vidéos déjà fabriquées sur le compte (les plus récentes d'abord).
async function listerVideos({ limit = 20, offset = 0 } = {}) {
  const r = await appelSynthesia('GET', `/videos?limit=${Number(limit) || 20}&offset=${Number(offset) || 0}`);
  if (!r.ok) return r;
  const data = r.data || {};
  return { ok: true, videos: data.videos || [] };
}

// Les avatars disponibles sur le compte, avec leur identifiant à passer en
// `avatar` (ou à mettre dans SYNTHESIA_AVATAR_ID).
async function listerAvatars({ limit = 100, offset = 0 } = {}) {
  const r = await appelSynthesia('GET', `/avatars?limit=${Number(limit) || 100}&offset=${Number(offset) || 0}`);
  if (!r.ok) return r;
  const data = r.data || {};
  return { ok: true, avatars: data.avatars || data.data || [] };
}

// Attend la fin du rendu en interrogeant Synthesia régulièrement.
// À n'utiliser QUE hors serverless (outil en ligne de commande, script) :
// un rendu dure plusieurs minutes, très au-delà des 60s d'une fonction
// Vercel. Une fonction serverless doit créer la vidéo, renvoyer l'id, et
// laisser un webhook ou un cron récupérer le résultat plus tard.
async function attendreVideo(id, { timeoutMs = 15 * 60 * 1000, intervalleMs = 15000, onTick } = {}) {
  const debut = Date.now();
  for (;;) {
    const r = await statutVideo(id);
    if (!r.ok) return r;
    if (typeof onTick === 'function') onTick(r);
    if (r.statut === 'complete') return r;
    if (r.statut === 'failed')   return { ok: false, error: 'Rendu Synthesia en échec', video: r.video };
    if (Date.now() - debut > timeoutMs) {
      return { ok: false, error: `Toujours en cours après ${Math.round(timeoutMs / 60000)} min — la vidéo continue de se fabriquer, réessayer "statut ${id}" plus tard.` };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalleMs));
  }
}

module.exports = { creerVideo, statutVideo, listerVideos, listerAvatars, attendreVideo, SYNTHESIA_BASE };
