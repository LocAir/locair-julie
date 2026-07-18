// Distance/durée de trajet réelles en voiture — API Google Routes (Compute
// Route Matrix), pas de calcul "à vol d'oiseau" : Nice a des collines, un
// port et des rues à sens unique dans le Vieux-Nice où la distance réelle
// diffère beaucoup de la distance directe.
async function computeRouteMatrix(points) {
  // points: [{lat, lng}, ...] — matrice N×N (chaque point comme origine ET
  // destination) pour pouvoir recalculer localement l'ordre restant après
  // un rendez-vous manqué, sans refaire d'appel à chaque étape.
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey || points.length < 2) return null;

  const waypoints = points.map(p => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } }));
  const body = {
    origins:      waypoints,
    destinations: waypoints,
    travelMode:   'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
  };

  try {
    const r = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'X-Goog-Api-Key':    apiKey,
        'X-Goog-FieldMask':  'originIndex,destinationIndex,distanceMeters,duration,condition',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) { console.error('[Routes API]', r.status, await r.text()); return null; }
    const elements = await r.json();

    const n = points.length;
    const matrix = Array.from({ length: n }, () => new Array(n).fill(Infinity));
    for (const el of (elements || [])) {
      if (el.condition !== 'ROUTE_EXISTS') continue;
      matrix[el.originIndex][el.destinationIndex] = el.distanceMeters;
    }
    return matrix;
  } catch (e) {
    console.error('[Routes API]', e.message);
    return null;
  }
}

// Plus proche voisin glouton : à chaque étape, choisit parmi les points pas
// encore visités celui dont la distance réelle depuis le point courant est
// la plus faible. Pas un optimiseur de tournée complet (TSP) — avec le petit
// nombre d'arrêts par jour de Loc'Air (2 à 6 en général), l'écart avec un
// optimum théorique est négligeable, et un vrai TSP serait disproportionné.
function nearestNeighborOrder(matrix, startIndex, remainingIndexes) {
  const order = [];
  let current = startIndex;
  const remaining = new Set(remainingIndexes);
  while (remaining.size > 0) {
    let best = null, bestDist = Infinity;
    for (const idx of remaining) {
      const d = matrix[current][idx];
      if (d < bestDist) { bestDist = d; best = idx; }
    }
    if (best == null) {
      // Aucune route trouvée vers les points restants (adresse isolée,
      // erreur de géocodage) — on les ajoute quand même, dans leur ordre
      // d'origine, plutôt que de les faire disparaître de la tournée.
      order.push(...remaining);
      break;
    }
    order.push(best);
    remaining.delete(best);
    current = best;
  }
  return order;
}

// Durée de trajet (minutes) entre un point de départ et un point d'arrivée
// uniques — utilisé pour l'ETA envoyée au client ("j'arrive dans X minutes"),
// contrairement à computeRouteMatrix() qui sert au tri de tournée par
// distance et ne remonte pas la durée à l'appelant. Même API Google Routes,
// mais un seul couple origine/destination au lieu d'une matrice N×N.
async function computeEtaMinutes(origin, destination) {
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey || !origin || !destination) return null;

  const body = {
    origins:      [{ waypoint: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } } }],
    destinations: [{ waypoint: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } } }],
    travelMode:   'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
  };

  try {
    const r = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'X-Goog-Api-Key':    apiKey,
        'X-Goog-FieldMask':  'originIndex,destinationIndex,duration,condition',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) { console.error('[Routes API — ETA]', r.status, await r.text()); return null; }
    const elements = await r.json();
    const el = (elements || []).find(e => e.condition === 'ROUTE_EXISTS');
    if (!el || !el.duration) return null;

    // duration est une chaîne du type "823s" (secondes, suffixe "s").
    const seconds = parseInt(el.duration, 10);
    if (!Number.isFinite(seconds)) return null;
    return Math.max(1, Math.round(seconds / 60));
  } catch (e) {
    console.error('[Routes API — ETA]', e.message);
    return null;
  }
}

module.exports = { computeRouteMatrix, nearestNeighborOrder, computeEtaMinutes };
