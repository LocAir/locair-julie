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

    const { data: cityResas } = await supabase.from('reservations').select('id').eq('city_id', city.id);
    const resaIds = (cityResas || []).map(r => r.id);
    let livraisons = 0;
    if (resaIds.length) {
      const { count } = await supabase
        .from('livraisons').select('id', { count: 'exact', head: true })
        .in('reservation_id', resaIds).eq('statut', 'probleme');
      livraisons = count || 0;
    }

    return res.status(200).json({ virements, livraisons });
  } catch (err) {
    console.error('[Admin alerts]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
