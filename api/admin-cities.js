const { getSupabase } = require('./_lib/supabase');
const { checkAdminToken } = require('./_lib/auth');

// Gestion des villes/zones — une "ville" ici est une zone opérationnelle
// pouvant couvrir plusieurs communes (ex. Nice + Saint-Laurent-du-Var +
// Cagnes-sur-Mer), routées par code postal (voir api/_lib/city.js,
// resolveCityByAddress). Contrairement au reste de l'app, la création
// d'une ville n'était jusqu'ici possible que par SQL direct (événement rare
// à l'origine) — désormais gérée depuis l'admin, la croissance multi-ville
// étant amenée à devenir courante.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    if (action === 'list') {
      const { data, error } = await supabase.from('cities').select('*').order('name');
      if (error) throw error;
      return res.status(200).json({ cities: data || [] });
    }

    if (action === 'create') {
      const name = (body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Nom requis' });
      const slug = (body.slug || name).trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // accents -> lettres simples
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!slug) return res.status(400).json({ error: 'Slug invalide' });
      const postalCodes = Array.isArray(body.postal_codes)
        ? body.postal_codes.map(cp => String(cp).trim()).filter(Boolean)
        : [];
      const { error } = await supabase.from('cities').insert({
        slug, name,
        dep:          (body.dep || '').trim() || null,
        postal:       postalCodes[0] || null,
        postal_codes: postalCodes,
        actif:        true,
      });
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Une ville avec ce slug existe déjà' });
        throw error;
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'update') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const patch = {};
      if (body.name != null)  patch.name  = body.name.trim();
      if (body.dep != null)   patch.dep   = body.dep.trim() || null;
      if (body.actif     != null) patch.actif     = Boolean(body.actif);
      if (body.sold_out  != null) patch.sold_out  = Boolean(body.sold_out);
      if (Array.isArray(body.postal_codes)) {
        patch.postal_codes = body.postal_codes.map(cp => String(cp).trim()).filter(Boolean);
      }
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Rien à modifier' });
      const { error } = await supabase.from('cities').update(patch).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin cities]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
