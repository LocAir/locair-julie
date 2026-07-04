const { getSupabase } = require('./_lib/supabase');
const { checkAdminToken } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkAdminToken(req)) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';
  const supabase = getSupabase();

  try {
    if (action === 'list') {
      const { data, error } = await supabase
        .from('reservations')
        .select('id, ref, prenom, nom, tel, email, adresse, date_debut, date_fin, quantite, prix_total_cents, statut, source, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return res.status(200).json({ reservations: data || [] });
    }

    if (action === 'update') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const patch = {};
      if (body.statut != null)   patch.statut   = body.statut;
      if (body.quantite != null) patch.quantite = Math.max(1, parseInt(body.quantite) || 1);
      if (body.prix_total_cents != null) patch.prix_total_cents = Math.max(0, parseInt(body.prix_total_cents) || 0);
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Rien à modifier' });
      const { error } = await supabase.from('reservations').update(patch).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin reservations]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
