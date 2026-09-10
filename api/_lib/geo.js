// Géocodage gratuit, sans clé, sans coût — sert à estimer une distance/ETA
// réelle (calcul de tournée transporteur) plutôt qu'une valeur fixe codée
// en dur. Passé de l'API officielle française (BAN, api-adresse.data.gouv.fr
// — uniquement la France) à Nominatim/OpenStreetMap (couverture mondiale)
// pour que l'adresse du box d'une ville hors de France (Madrid, Rome...)
// se géocode aussi correctement — voir multi-pays, migration_2026-09-10.
// User-Agent identifiable requis par la politique d'usage de Nominatim.
async function geocodeAddress(adresse) {
  if (!adresse) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(adresse)}&format=json&limit=1`;
    const r = await fetch(url, { headers: { 'User-Agent': "LocAir/1.0 (contact@locair.fr)" } });
    if (!r.ok) return null;
    const results = await r.json();
    const f = results && results[0];
    if (!f) return null;
    return { lat: parseFloat(f.lat), lng: parseFloat(f.lon) };
  } catch (e) {
    return null;
  }
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { geocodeAddress, haversineKm };
