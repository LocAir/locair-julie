const { getSupabase } = require('./_lib/supabase');
const { getCity }     = require('./_lib/city');
const { checkAdminToken } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkAdminToken(req)) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';
  const supabase = getSupabase();

  try {
    if (action === 'list') {
      const { data, error } = await supabase.from('transporteurs').select('*').order('nom');
      if (error) throw error;
      return res.status(200).json({ transporteurs: data || [] });
    }

    if (action === 'create') {
      const nom = (body.nom || '').trim();
      if (!nom) return res.status(400).json({ error: 'Nom requis' });
      const city = await getCity(supabase);
      const { error } = await supabase.from('transporteurs').insert({
        city_id:                city.id,
        nom,
        telephone:              (body.telephone || '').trim() || null,
        taux_livraison_cents:   Math.max(0, parseInt(body.taux_livraison_cents)   || 0),
        taux_recuperation_cents: Math.max(0, parseInt(body.taux_recuperation_cents) || 0),
      });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'update') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const patch = {};
      if (body.nom != null)       patch.nom       = body.nom.trim();
      if (body.telephone != null) patch.telephone = body.telephone.trim() || null;
      if (body.actif != null)     patch.actif     = Boolean(body.actif);
      if (body.taux_livraison_cents != null)    patch.taux_livraison_cents    = Math.max(0, parseInt(body.taux_livraison_cents)    || 0);
      if (body.taux_recuperation_cents != null) patch.taux_recuperation_cents = Math.max(0, parseInt(body.taux_recuperation_cents) || 0);
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Rien à modifier' });
      const { error } = await supabase.from('transporteurs').update(patch).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin transporteurs]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
