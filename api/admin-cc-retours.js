// Click & Collect — appareils rendus « À reconditionner » (photo du dépôt
// dans sa housse), et passage en « prêt » une fois remis en état.
// Réservé à l'admin. Page : admin/cc-retours.html.
// Colonnes : supabase/migration_2026-11-20_cc_retour_photo.sql.
const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { getPointRetrait } = require('./_lib/pointsRetrait');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const a = await checkAdminRole(req, supabase);
  if (!a.ok) return res.status(401).json({ error: 'Non autorisé' });
  const b = req.body || {};
  try {
    if (b.action === 'pret') {
      const id = parseInt(b.id, 10);
      if (!id) return res.status(400).json({ error: 'Réservation manquante' });
      const { error } = await supabase.from('reservations').update({ etat_retour: 'pret' }).eq('id', id).eq('etat_retour', 'a_reconditionner');
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    const { data, error } = await supabase.from('reservations')
      .select('id, ref, prenom, nom, point_retrait_id, rendu_at, retour_photo, etat_retour')
      .eq('source_channel', 'click_collect').in('etat_retour', ['a_reconditionner', 'pret'])
      .order('rendu_at', { ascending: false }).limit(100);
    if (error) {
      if (/etat_retour|retour_photo|does not exist|42703/.test(error.message + (error.code || ''))) return res.status(200).json({ manque_colonnes: true });
      return res.status(500).json({ error: error.message });
    }
    const lignes = [];
    for (const r of data || []) {
      let photo = null;
      if (r.retour_photo) {
        const { data: su } = await supabase.storage.from('missions').createSignedUrl(r.retour_photo, 3600);
        photo = su && su.signedUrl;
      }
      const pt = getPointRetrait(r.point_retrait_id || '');
      lignes.push({ id: r.id, ref: r.ref, client: `${r.prenom || ''} ${r.nom || ''}`.trim(), point: pt ? pt.nom : '', rendu_at: r.rendu_at, etat: r.etat_retour, photo });
    }
    return res.status(200).json({ retours: lignes });
  } catch (e) {
    console.error('[admin-cc-retours]', e.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
