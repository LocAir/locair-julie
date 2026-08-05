const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity } = require('./_lib/city');
const { checkAdminToken } = require('./_lib/auth');
const { isValidDate, todayParis } = require('./_lib/dates');
const { computeChecklistBoxFromMissions, CHECKLIST_BOX_SELECT } = require('./_lib/checklistBox');

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

    const dateISO = isValidDate(body.date) ? body.date : todayParis();

    const { data: transporteurs, error } = await supabase
      .from('transporteurs').select('id, nom')
      .eq('city_id', city.id).eq('actif', true).order('nom');
    if (error) throw error;

    const tIds = (transporteurs || []).map(t => t.id);
    // Un seul aller-retour pour TOUS les transporteurs de la ville plutôt
    // qu'une requête missions + une requête checklist_box PAR transporteur
    // (jusqu'à 2×N requêtes séquentielles pour une équipe de N livreurs) —
    // même principe que le correctif déjà en place dans admin-stock.js
    // "entretien_liste".
    const [{ data: livsAll, error: livsErr }, { data: validations, error: valErr }] = tIds.length
      ? await Promise.all([
          supabase.from('livraisons').select(CHECKLIST_BOX_SELECT)
            .in('transporteur_id', tIds).eq('date_prevue', dateISO).eq('masquee', false)
            .not('statut', 'in', '(annule,refusee)'),
          supabase.from('checklist_box').select('transporteur_id, validated_at')
            .in('transporteur_id', tIds).eq('date', dateISO),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (livsErr) throw livsErr;
    if (valErr) throw valErr;

    const missionsByTransp = {};
    for (const l of (livsAll || [])) {
      (missionsByTransp[l.transporteur_id] = missionsByTransp[l.transporteur_id] || []).push(l);
    }
    const validationByTransp = new Map((validations || []).map(v => [v.transporteur_id, v]));

    const checklists = [];
    for (const t of (transporteurs || [])) {
      const checklist = computeChecklistBoxFromMissions(missionsByTransp[t.id] || [], dateISO);
      if (!checklist || checklist.nb_missions === 0) continue;
      const v = validationByTransp.get(t.id);
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
