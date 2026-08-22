// Note, nombre d'avis ET avis eux-mêmes (API Places), pour affichage
// automatique sur le site public.
//
// Les avis sont renvoyés TELS QUE GOOGLE LES DONNE : ni retouchés, ni
// choisis, ni traduits. C'est une obligation des conditions d'utilisation
// de Google, et c'est aussi la seule façon d'être crédible — un avis
// arrangé se repère.
// Si les variables d'environnement manquent, ou si Google répond autre
// chose que ce qu'on attend, on renvoie available:false et le site
// n'affiche RIEN. Jamais d'avis inventé pour combler un trou. Mis en cache en mémoire quelques heures pour rester
// largement dans le quota gratuit — un visiteur de plus ne déclenche jamais
// un nouvel appel à Google tant que le cache est valide.
let _cache = null; // { data, at }
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID;
  // Tant que les deux variables Vercel ne sont pas configurées, on répond
  // "indisponible" plutôt que de planter — le site continue d'afficher ses
  // chiffres statiques existants.
  if (!apiKey || !placeId) {
    return res.status(200).json({ available: false });
  }

  if (_cache && (Date.now() - _cache.at) < TTL_MS) {
    return res.status(200).json(_cache.data);
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=rating,user_ratings_total,reviews&key=${encodeURIComponent(apiKey)}`;
    const r = await fetch(url);
    const body = await r.json();
    const rating = body?.result?.rating;
    const count = body?.result?.user_ratings_total;
    if (body.status !== 'OK' || typeof rating !== 'number' || typeof count !== 'number') {
      console.error('[google-rating GET] réponse Google inattendue', body.status, body.error_message);
      return res.status(200).json({ available: false });
    }
    // On ne garde que ce qu'on affiche, et on borne la longueur du texte :
    // une carte d'avis n'est pas un article. Le texte n'est PAS coupé au
    // milieu d'un mot ni réécrit — s'il dépasse, il est tronqué proprement
    // et suivi d'un caractère de suite.
    const reviews = Array.isArray(body?.result?.reviews)
      ? body.result.reviews
          .filter(a => a && typeof a.text === 'string' && a.text.trim().length > 30
                    && typeof a.rating === 'number')
          .slice(0, 6)
          .map(a => {
            const brut = a.text.trim().replace(/\s+/g, ' ');
            const coupe = brut.length > 260;
            const texte = coupe ? brut.slice(0, 260).replace(/\s+\S*$/, '') + '…' : brut;
            return {
              auteur: (a.author_name || '').trim(),
              note: a.rating,
              quand: (a.relative_time_description || '').trim(),
              texte,
            };
          })
      : [];
    const data = { available: true, rating, count, reviews };
    _cache = { data, at: Date.now() };
    return res.status(200).json(data);
  } catch (err) {
    console.error('[google-rating GET]', err.message);
    return res.status(200).json({ available: false });
  }
};
