const { getSupabase } = require('./_lib/supabase');
const { getCity }     = require('./_lib/city');
const { checkAdminToken } = require('./_lib/auth');

// Compte, par onglet, ce qui attend une action de l'admin — affiché en badge
// sur la barre latérale. Pensé pour être étendu facilement (nouvel onglet =
// une clé de plus dans la réponse) le jour où un espace client existera.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  try {
    const city = await getCity(supabase);

    const { data: cityTransp } = await supabase.from('transporteurs').select('id').eq('city_id', city.id);
    const transpIds = (cityTransp || []).map(t => t.id);
    let virements = 0;
    if (transpIds.length) {
      const { count } = await supabase
        .from('virements').select('id', { count: 'exact', head: true })
        .in('transporteur_id', transpIds).eq('statut', 'demande');
      virements = count || 0;
    }

    // Une réservation masquée (doublon retiré de l'écran par l'admin) ne doit
    // gonfler ni le badge "problèmes/non assignées" ni le bandeau permanent.
    const { data: cityResas } = await supabase.from('reservations').select('id').eq('city_id', city.id).eq('masquee', false);
    const resaIds = (cityResas || []).map(r => r.id);
    let livraisons = 0;
    let nonAssignees = 0;
    if (resaIds.length) {
      const { count: problemeCount } = await supabase
        .from('livraisons').select('id', { count: 'exact', head: true })
        .in('reservation_id', resaIds).eq('statut', 'probleme');
      // Le pire scénario opérationnel : une réservation confirmée dont les
      // missions n'ont encore aucun livreur assigné — sans ce compteur, rien
      // ne signale activement qu'un client attend une livraison non dispatchée.
      // Limité aux missions dues sous 72h (ou déjà en retard) : au-delà, ne
      // pas avoir encore assigné est normal (le dispatch se fait au fil de
      // l'eau) — tout compter en alerte permanente rendrait le signal
      // inutile, allumé en continu même quand rien n'est urgent.
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 3);
      const horizonStr = horizon.toISOString().slice(0, 10);
      const { count: nonAssigneesCount } = await supabase
        .from('livraisons').select('id', { count: 'exact', head: true })
        .in('reservation_id', resaIds).eq('statut', 'a_faire').is('transporteur_id', null)
        .lte('date_prevue', horizonStr);
      livraisons = (problemeCount || 0) + (nonAssigneesCount || 0);
      nonAssignees = nonAssigneesCount || 0;
    }

    return res.status(200).json({ virements, livraisons, non_assignees: nonAssignees });
  } catch (err) {
    console.error('[Admin alerts]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
