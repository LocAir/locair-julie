const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');

// Panneau de contrôle des packs à prix fixe (ex. "Pack Sérénité Solo/Duo")
// — voir migration_forfaits.sql et api/_lib/forfaits.js. Lecture ouverte à
// tout compte connecté (comme Tarifs/Offres), création/modification/
// suppression réservées aux comptes administrateur.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    if (action === 'list') {
      const { data, error } = await supabase.from('forfaits').select('*').order('quantite');
      if (error) throw error;
      const forfaits = data || [];
      // Nombre de réservations réelles par pack — pour qu'Aly voie tout de
      // suite si un pack est utilisé ou totalement ignoré, sans avoir à
      // recouper l'onglet Réservations à la main. Best-effort : une erreur
      // ici n'empêche jamais d'afficher la liste des packs elle-même.
      if (forfaits.length) {
        try {
          const { data: resas } = await supabase.from('reservations').select('forfait_id').not('forfait_id', 'is', null);
          const counts = {};
          for (const r of (resas || [])) counts[r.forfait_id] = (counts[r.forfait_id] || 0) + 1;
          forfaits.forEach((f) => { f.nb_reservations = counts[f.id] || 0; });
        } catch (e) {
          console.error('[Admin forfaits] comptage réservations:', e.message);
        }
      }
      return res.status(200).json({ forfaits });
    }

    if (!roleHasAccess(admin.role, 'reglages')) return res.status(403).json({ error: "Ton compte n'a pas accès aux réglages." });

    if (action === 'create' || action === 'update') {
      const nom = (body.nom || '').trim();
      if (!nom) return res.status(400).json({ error: 'Nom requis' });

      const quantite = parseInt(body.quantite, 10);
      if (!Number.isFinite(quantite) || quantite < 1 || quantite > 5) {
        return res.status(400).json({ error: 'La quantité doit être comprise entre 1 et 5' });
      }
      const dureeJours = parseInt(body.duree_jours, 10);
      if (!Number.isFinite(dureeJours) || dureeJours < 1 || dureeJours > 90) {
        return res.status(400).json({ error: 'La durée doit être comprise entre 1 et 90 jours' });
      }
      const prixCents = Math.round(parseFloat(body.prix) * 100);
      if (!Number.isFinite(prixCents) || prixCents <= 0) {
        return res.status(400).json({ error: 'Le prix doit être un nombre positif' });
      }
      const actif = body.actif !== false;

      const patch = { nom, quantite, duree_jours: dureeJours, prix_cents: prixCents, actif };

      if (action === 'create') {
        const { error } = await supabase.from('forfaits').insert(patch);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      const id = parseInt(body.id, 10);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { error } = await supabase.from('forfaits').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'toggle') {
      const id = parseInt(body.id, 10);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { error } = await supabase.from('forfaits').update({ actif: body.actif === true, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete') {
      const id = parseInt(body.id, 10);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { error } = await supabase.from('forfaits').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin forfaits]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
