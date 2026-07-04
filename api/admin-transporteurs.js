const { getSupabase } = require('./_lib/supabase');
const { getCity }     = require('./_lib/city');
const { checkAdminToken } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

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

      // Code personnel à 6 chiffres — généré automatiquement si non fourni.
      let pin = (body.pin || '').trim();
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = pin || String(Math.floor(100000 + Math.random() * 900000));
        const { error } = await supabase.from('transporteurs').insert({
          city_id:                 city.id,
          nom,
          telephone:               (body.telephone || '').trim() || null,
          email:                   (body.email || '').trim().toLowerCase() || null,
          pin:                     candidate,
          taux_livraison_cents:    Math.max(0, parseInt(body.taux_livraison_cents)    || 0),
          taux_recuperation_cents: Math.max(0, parseInt(body.taux_recuperation_cents) || 0),
        });
        if (!error) return res.status(200).json({ ok: true, pin: candidate });
        if (pin || error.code !== '23505') throw error; // pin fourni par l'admin ou autre erreur : ne pas boucler
      }
      return res.status(500).json({ error: 'Impossible de générer un code unique, réessaie' });
    }

    if (action === 'update') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const patch = {};
      if (body.nom != null)       patch.nom       = body.nom.trim();
      if (body.telephone != null) patch.telephone = body.telephone.trim() || null;
      if (body.email != null)     patch.email     = body.email.trim().toLowerCase() || null;
      if (body.actif != null)     patch.actif     = Boolean(body.actif);
      if (body.pin != null && body.pin.trim())  patch.pin = body.pin.trim();
      if (body.taux_livraison_cents != null)    patch.taux_livraison_cents    = Math.max(0, parseInt(body.taux_livraison_cents)    || 0);
      if (body.taux_recuperation_cents != null) patch.taux_recuperation_cents = Math.max(0, parseInt(body.taux_recuperation_cents) || 0);
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Rien à modifier' });
      const { error } = await supabase.from('transporteurs').update(patch).eq('id', id);
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Ce code est déjà utilisé par un autre transporteur, réessaie' });
        throw error;
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin transporteurs]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
