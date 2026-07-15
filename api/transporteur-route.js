const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');
const { geocodeAddress } = require('./_lib/geo');
const { computeRouteMatrix, nearestNeighborOrder } = require('./_lib/routing');

// Calcule l'ordre de tournée du jour (plus proche en voiture, pas à vol
// d'oiseau) à partir d'un point de départ choisi par le livreur au début de
// sa journée : soit le box (adresse fixe de la ville), soit sa position
// actuelle (matériel déjà chez lui, urgence — voir transporteur/index.html,
// écran "Comment démarres-tu ta journée ?"). Recalculé à chaque appel, pas
// stocké en base — le petit volume quotidien ne justifie pas de le
// persister ; le client garde la matrice de distances reçue pour
// recalculer localement l'ordre restant après un rendez-vous manqué, sans
// refaire d'appel.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const transporteurId = await verifyTransporteurToken(req, supabase);
  if (!transporteurId) return res.status(401).json({ error: 'Session invalide' });

  const body = req.body || {};
  let startLat = parseFloat(body.start_lat);
  let startLng = parseFloat(body.start_lng);

  try {
    const { data: transporteur } = await supabase.from('transporteurs').select('city_id').eq('id', transporteurId).maybeSingle();
    if (!transporteur) return res.status(404).json({ error: 'Transporteur introuvable' });

    // "Partir du box" : le client n'envoie pas de coordonnées, on prend
    // celles enregistrées sur la ville (voir admin-cities.js, depot_lat/lng).
    if (!Number.isFinite(startLat) || !Number.isFinite(startLng)) {
      const { data: city } = await supabase.from('cities').select('depot_lat, depot_lng').eq('id', transporteur.city_id).maybeSingle();
      if (!city || city.depot_lat == null) {
        return res.status(422).json({ error: "Adresse du box non configurée — contacte Aly." });
      }
      startLat = city.depot_lat;
      startLng = city.depot_lng;
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const { data: livraisons, error } = await supabase
      .from('livraisons')
      .select('id, type, statut, date_prevue, reservation:reservations(adresse)')
      .eq('transporteur_id', transporteurId)
      .eq('masquee', false)
      .in('statut', ['a_faire', 'acceptee', 'en_route', 'arrivee'])
      .lte('date_prevue', todayStr);
    if (error) throw error;

    const missions = (livraisons || []).filter(m => m.reservation && m.reservation.adresse);
    if (missions.length === 0) return res.status(200).json({ order: [] });

    // Géocode chaque adresse client en parallèle — gratuit (API officielle
    // adresse.data.gouv.fr, déjà utilisée ailleurs dans le projet), aucune
    // coordonnée stockée pour les réservations.
    const geocoded = await Promise.all(missions.map(m => geocodeAddress(m.reservation.adresse)));
    const valid = missions.map((m, i) => ({ mission: m, geo: geocoded[i] })).filter(x => x.geo);
    const missingIds = missions.filter(m => !valid.find(x => x.mission.id === m.id)).map(m => m.id);

    if (valid.length === 0) {
      return res.status(200).json({ order: missions.map(m => m.id), degraded: true });
    }

    const points = [{ lat: startLat, lng: startLng }, ...valid.map(x => x.geo)];
    const matrix = await computeRouteMatrix(points);

    if (!matrix) {
      // Clé Google absente ou API en erreur : on renvoie quand même une
      // liste (ordre non optimisé) plutôt que de bloquer le livreur.
      return res.status(200).json({ order: [...valid.map(x => x.mission.id), ...missingIds], degraded: true });
    }

    const remainingIdx = valid.map((_, i) => i + 1); // décalé de 1 (index 0 = point de départ)
    const orderIdx = nearestNeighborOrder(matrix, 0, remainingIdx);
    const order = orderIdx.map(i => valid[i - 1].mission.id);

    return res.status(200).json({
      order: [...order, ...missingIds],
      points,
      matrix,
      missionIndex: valid.map(x => x.mission.id), // missionIndex[i-1] = id de la mission au point d'index i
    });
  } catch (err) {
    console.error('[Transporteur route]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
