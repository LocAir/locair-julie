// Compteurs du parc pour une ville — partagés entre admin-stock.js (onglet
// Stock) et admin-dashboard.js (Module 7, bloc "État du parc" sur l'écran
// Accueil), pour ne calculer cette logique qu'à un seul endroit.
async function computeParcDashboard(supabase, cityId) {
  // Un appareil "vendu" (Offre Privilège) a définitivement quitté le parc de
  // location — il ne doit plus apparaître dans aucun des compteurs ici,
  // exactement comme s'il n'avait jamais existé pour ce tableau de bord.
  const { data: appareils } = await supabase.from('appareils').select('id, statut').eq('city_id', cityId).neq('statut', 'vendu');
  const list = appareils || [];
  const parStatut = { disponible: 0, panne: 0, maintenance: 0, nettoyage: 0, loue: 0 };
  list.forEach(a => { if (parStatut[a.statut] != null) parStatut[a.statut]++; });

  const [{ data: liens }, { data: livsEnCours }] = await Promise.all([
    supabase.from('reservation_appareils').select('appareil_id, reservation_id, reservation:reservations(statut)'),
    supabase.from('livraisons').select('reservation_id').eq('type', 'livraison').neq('statut', 'fait'),
  ]);
  const resaEnPrepIds = new Set((livsEnCours || []).map(l => l.reservation_id));
  const enPreparation = new Set(
    (liens || [])
      .filter(l => l.reservation && l.reservation.statut === 'confirmee' && resaEnPrepIds.has(l.reservation_id))
      .map(l => l.appareil_id)
  ).size;

  return {
    total: list.length,
    disponibles: parStatut.disponible,
    en_location: parStatut.loue,
    en_preparation: enPreparation,
    en_maintenance: parStatut.maintenance + parStatut.nettoyage,
    hors_service: parStatut.panne,
  };
}

module.exports = { computeParcDashboard };
