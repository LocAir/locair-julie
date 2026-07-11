const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');
const { computeChecklistBox } = require('./_lib/checklistBox');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const transporteurId = await verifyTransporteurToken(req, supabase);
  if (!transporteurId) return res.status(401).json({ error: 'Session invalide' });

  const body   = req.body || {};
  const action = body.action || 'get';
  // Toujours le jour du transporteur qui consulte, jamais une date fournie
  // par le client — cette checklist n'a de sens que pour "aujourd'hui".
  const dateISO = new Date().toISOString().slice(0, 10);

  try {
    if (action === 'get') {
      const checklist = await computeChecklistBox(supabase, transporteurId, dateISO);
      const { data: v } = await supabase
        .from('checklist_box').select('validated_at')
        .eq('transporteur_id', transporteurId).eq('date', dateISO).maybeSingle();
      return res.status(200).json({ ...checklist, validated: Boolean(v), validated_at: v?.validated_at || null });
    }

    if (action === 'valider') {
      const { error } = await supabase.from('checklist_box')
        .upsert({ transporteur_id: transporteurId, date: dateISO, validated_at: new Date().toISOString() }, { onConflict: 'transporteur_id,date' });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'annuler') {
      const { error } = await supabase.from('checklist_box')
        .delete().eq('transporteur_id', transporteurId).eq('date', dateISO);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Transporteur checklist]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
