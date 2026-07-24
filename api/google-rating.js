// Note et nombre d'avis Google (API Places), pour affichage automatique sur
// le site public. Mis en cache en mémoire quelques heures pour rester
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
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=rating,user_ratings_total&key=${encodeURIComponent(apiKey)}`;
    const r = await fetch(url);
    const body = await r.json();
    const rating = body?.result?.rating;
    const count = body?.result?.user_ratings_total;
    if (body.status !== 'OK' || typeof rating !== 'number' || typeof count !== 'number') {
      console.error('[google-rating GET] réponse Google inattendue', body.status, body.error_message);
      return res.status(200).json({ available: false });
    }
    const data = { available: true, rating, count };
    _cache = { data, at: Date.now() };
    return res.status(200).json(data);
  } catch (err) {
    console.error('[google-rating GET]', err.message);
    return res.status(200).json({ available: false });
  }
};
