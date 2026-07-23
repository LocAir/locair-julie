const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity } = require('./_lib/city');
const { checkAdminToken } = require('./_lib/auth');
const { isValidDate } = require('./_lib/dates');
const { computeChecklistBox } = require('./_lib/checklistBox');

// Vue journalière pour l'admin : la checklist box de chaque transporteur actif
// de la ville, pour un jour donné (aujourd'hui par défaut) — pour voir d'un
// coup d'œil qui a du matériel à préparer et qui a déjà pris en charge sa
// checklist, sans dépendre du téléphone de chacun.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body = req.body || {};

  try {
    const city = await resolveAdminCity(supabase, body);
    if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });

    const dateISO = isValidDate(body.date) ? body.date : new Date().toISOString().slice(0, 10);

    const { data: transporteurs, error } = await supabase
      .from('transporteurs').select('id, nom')
      .eq('city_id', city.id).eq('actif', true).order('nom');
    if (error) throw error;

    const checklists = [];
    for (const t of (transporteurs || [])) {
      const checklist = await computeChecklistBox(supabase, t.id, dateISO);
      if (!checklist || checklist.nb_missions === 0) continue;
      const { data: v, error: vErr } = await supabase
        .from('checklist_box').select('validated_at')
        .eq('transporteur_id', t.id).eq('date', dateISO).maybeSingle();
      if (vErr) throw vErr;
      checklists.push({
        transporteur_id: t.id, nom: t.nom, ...checklist,
        validated: Boolean(v), validated_at: v?.validated_at || null,
      });
    }

    return res.status(200).json({ date: dateISO, checklists });
  } catch (err) {
    console.error('[Admin checklist]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
