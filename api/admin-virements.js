const { getSupabase } = require('./_lib/supabase');
const { getCity }     = require('./_lib/city');
const { checkAdminToken } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    const city = await getCity(supabase);
    // virements n'a pas de city_id direct — on passe par les transporteurs de
    // cette ville pour ne jamais faire fuiter les paiements d'une autre ville
    // partageant la même base Supabase.
    const { data: cityTransp } = await supabase.from('transporteurs').select('id').eq('city_id', city.id);
    const transpIds = (cityTransp || []).map(t => t.id);

    if (action === 'list') {
      if (!transpIds.length) return res.status(200).json({ virements: [] });
      const { data, error } = await supabase
        .from('virements')
        .select('id, montant_cents, statut, created_at, verse_at, transporteur:transporteurs ( id, nom )')
        .in('transporteur_id', transpIds)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return res.status(200).json({ virements: data || [] });
    }

    if (action === 'marquer_verse') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });

      const { data: virement } = await supabase.from('virements').select('*').eq('id', id).in('transporteur_id', transpIds).maybeSingle();
      if (!virement) return res.status(404).json({ error: 'Virement introuvable' });
      if (virement.statut === 'verse') return res.status(409).json({ error: 'Déjà marqué comme versé' });

      // Recalcul du montant réel au moment du virement (peut différer de la demande
      // si d'autres missions ont été terminées entre-temps).
      const { data: faites } = await supabase
        .from('livraisons').select('id, montant_du_cents')
        .eq('transporteur_id', virement.transporteur_id).eq('statut', 'fait').eq('paye', false);
      const montant = (faites || []).reduce((s, f) => s + (f.montant_du_cents || 0), 0);
      const ids = (faites || []).map(f => f.id);

      if (ids.length) {
        await supabase.from('livraisons').update({ paye: true }).in('id', ids);
      }
      await supabase.from('virements').update({ statut: 'verse', montant_cents: montant, verse_at: new Date().toISOString() }).eq('id', id);

      return res.status(200).json({ ok: true, montant_cents: montant });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin virements]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
