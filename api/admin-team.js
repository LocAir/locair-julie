const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess, ROLES } = require('./_lib/permissions');

// Gestion des comptes équipe (Module 7, Partie 31) — réservée au rôle
// "administrateur". Le compte historique (mot de passe partagé) a toujours
// ce rôle, donc reste toujours autorisé ici.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });
  if (!roleHasAccess(admin.role, 'equipe')) {
    return res.status(403).json({ error: "Ton compte n'a pas accès à la gestion de l'équipe." });
  }

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    if (action === 'list') {
      const { data, error } = await supabase.from('admin_users')
        .select('id, nom, email, role, actif, created_at, last_login_at').order('nom');
      if (error) throw error;
      return res.status(200).json({ membres: data || [] });
    }

    if (action === 'create') {
      const nom = (body.nom || '').trim();
      const role = (body.role || '').trim();
      if (!nom) return res.status(400).json({ error: 'Nom requis' });
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide' });

      let pin = (body.pin || '').trim();
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = pin || String(Math.floor(100000 + Math.random() * 900000));
        const { data: created, error } = await supabase.from('admin_users').insert({
          nom,
          email: (body.email || '').trim().toLowerCase() || null,
          pin: candidate,
          role,
        }).select('id').single();
        if (!error) return res.status(200).json({ ok: true, id: created.id, pin: candidate });
        if (pin || error.code !== '23505') throw error;
      }
      return res.status(500).json({ error: 'Impossible de générer un code unique, réessaie' });
    }

    if (action === 'update') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const patch = {};
      if (body.nom != null) patch.nom = body.nom.trim();
      if (body.email != null) patch.email = body.email.trim().toLowerCase() || null;
      if (body.role != null) {
        if (!ROLES.includes(body.role)) return res.status(400).json({ error: 'Rôle invalide' });
        patch.role = body.role;
      }
      if (body.actif != null) patch.actif = Boolean(body.actif);
      if (body.pin != null && body.pin.trim()) patch.pin = body.pin.trim();
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Rien à modifier' });

      const { error } = await supabase.from('admin_users').update(patch).eq('id', id);
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Ce code est déjà utilisé par un autre membre, réessaie' });
        throw error;
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { error } = await supabase.from('admin_users').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin team]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
