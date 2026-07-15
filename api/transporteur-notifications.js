const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');

// Centre de notifications transporteur (Module 5, Partie 11) — liste,
// compteur non lues, marquage lu. Les événements sont écrits par
// _lib/transporteurNotif.js à chaque action métier qui concerne ce
// transporteur (nouvelle mission, modification, annulation, incident,
// validation, paiement).
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const transporteurId = await verifyTransporteurToken(req, supabase);
  if (!transporteurId) return res.status(401).json({ error: 'Session invalide' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    if (action === 'list') {
      const { data, error } = await supabase
        .from('transporteur_notifications')
        .select('id, type, message, livraison_id, lu, created_at')
        .eq('transporteur_id', transporteurId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      const nonLues = (data || []).filter(n => !n.lu).length;
      return res.status(200).json({ notifications: data || [], non_lues: nonLues });
    }

    if (action === 'marquer_lu') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      await supabase.from('transporteur_notifications').update({ lu: true, lu_at: new Date().toISOString() })
        .eq('id', id).eq('transporteur_id', transporteurId);
      return res.status(200).json({ ok: true });
    }

    if (action === 'marquer_tout_lu') {
      await supabase.from('transporteur_notifications').update({ lu: true, lu_at: new Date().toISOString() })
        .eq('transporteur_id', transporteurId).eq('lu', false);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Transporteur notifications]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
