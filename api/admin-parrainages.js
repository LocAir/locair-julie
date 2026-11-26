// Admin : parrainages entre commerçants (demandes de rappel venues d'un lien
// de parrainage, table parrainages). L'admin passe une demande à « signé »
// (parrainage activé : 50 € au
// parrain et au nouveau, à verser à la main) ou « refusé ».
// POST { action: 'liste' } | { action: 'statut', id, statut }
const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const a = await checkAdminRole(req, supabase);
  if (!a.ok) return res.status(401).json({ error: 'Non autorisé' });
  const b = req.body || {};
  try {
    if (b.action === 'statut') {
      // Valider un parrainage = 50 € + 50 € à verser : rôles « partenaires » seulement.
      if (!roleHasAccess(a.role, 'partenaires')) return res.status(403).json({ error: 'Ton compte n’a pas accès aux parrainages.' });
      const id = parseInt(b.id, 10);
      const statut = ['en_attente', 'signe', 'refuse'].includes(b.statut) ? b.statut : null;
      if (!id || !statut) return res.status(400).json({ error: 'Demande invalide' });
      const { error } = await supabase.from('parrainages')
        .update({ statut, signe_at: statut === 'signe' ? new Date().toISOString() : null }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    const { data, error } = await supabase.from('parrainages')
      .select('*')
      .order('created_at', { ascending: false }).limit(200);
    if (error) {
      if (/parrainages|does not exist|42P01/.test(String(error.message) + (error.code || ''))) return res.status(200).json({ manque_table: true, parrainages: [] });
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ parrainages: data || [] });
  } catch (e) {
    console.error('[admin-parrainages]', e.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
