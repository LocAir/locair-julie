// Click & Collect — appareils rendus « À reconditionner » (photo du dépôt
// dans sa housse), et passage en « prêt » une fois remis en état.
// Réservé à l'admin. Page : admin/cc-retours.html.
// Colonnes : supabase/migration_2026-11-20_cc_retour_photo.sql.
const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { getPointRetrait, POINTS_RETRAIT } = require('./_lib/pointsRetrait');
const { codeRetour } = require('./_lib/clickCollect');

module.exports = async (req, res) => {
  await require('./_lib/pointsRetrait').chargerPoints(); // points créés dans l'admin
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const a = await checkAdminRole(req, supabase);
  if (!a.ok) return res.status(401).json({ error: 'Non autorisé' });
  const b = req.body || {};
  try {
    // Flyers commerçants (admin/flyers-commercants.html) : pour chaque point de
    // retrait, son code retour, à imprimer et à remettre au commerçant.
    // Jamais affiché sur le site public.
    if (b.action === 'flyers') {
      const codes = POINTS_RETRAIT.filter((p) => !p.test).map((p) => String(p.partenaire_code || '').toLowerCase()).filter(Boolean);
      let partenaires = [];
      if (codes.length) {
        const { data } = await supabase.from('partenaires').select('code, nom, telephone').in('code', codes);
        partenaires = data || [];
      }
      const points = POINTS_RETRAIT.filter((p) => !p.test).map((p) => {
        const part = partenaires.find((x) => String(x.code || '').toLowerCase() === String(p.partenaire_code || '').toLowerCase()) || null;
        return { id: p.id, nom: p.nom, adresse: p.adresse, exemple: !!p.exemple, partenaire: part ? (part.nom || part.code) : null, partenaire_code: p.partenaire_code || null, code_retour: codeRetour(p, part) };
      });
      return res.status(200).json({ points });
    }
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
