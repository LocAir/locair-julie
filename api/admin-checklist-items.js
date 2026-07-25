const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');

// CRUD admin des checklists administrables (installation / récupération) —
// Module 5, Parties 5 et 7. Pas de notion de ville : bibliothèque unique,
// comme tutoriel_videos.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    if (action === 'list') {
      const { data, error } = await supabase
        .from('checklist_items').select('id, workflow, libelle, ordre, actif')
        .order('workflow', { ascending: true }).order('ordre', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ items: data || [] });
    }

    if (action === 'create') {
      if (!roleHasAccess(admin.role, 'logistique')) return res.status(403).json({ error: "Ton compte n'a pas accès à la logistique." });
      const workflow = body.workflow;
      const libelle  = (body.libelle || '').trim();
      if (!['installation', 'recuperation', 'changement'].includes(workflow) || !libelle) {
        return res.status(400).json({ error: 'Paramètres manquants' });
      }
      const { error } = await supabase.from('checklist_items').insert({
        workflow, libelle: libelle.slice(0, 200), ordre: parseInt(body.ordre) || 0,
      });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'update') {
      if (!roleHasAccess(admin.role, 'logistique')) return res.status(403).json({ error: "Ton compte n'a pas accès à la logistique." });
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const patch = {};
      if (typeof body.libelle === 'string') {
        const libelle = body.libelle.trim();
        if (!libelle) return res.status(400).json({ error: 'Libellé ne peut pas être vide' });
        patch.libelle = libelle.slice(0, 200);
      }
      if (body.ordre != null) patch.ordre = parseInt(body.ordre) || 0;
      if (typeof body.actif === 'boolean') patch.actif = body.actif;
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Rien à modifier' });
      const { error } = await supabase.from('checklist_items').update(patch).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete') {
      if (!roleHasAccess(admin.role, 'logistique')) return res.status(403).json({ error: "Ton compte n'a pas accès à la logistique." });
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { error } = await supabase.from('checklist_items').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin checklist items]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
