const { getSupabase } = require('./_lib/supabase');
const { checkAdminToken } = require('./_lib/auth');

// Centre d'aide client (Module 4) — contenu administrable, consommé par
// l'espace client (api/client-dashboard.js) et potentiellement par un futur
// assistant IA (structure stable par slug/catégorie).
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    if (action === 'list') {
      const { data, error } = await supabase.from('centre_aide_articles').select('*').order('ordre');
      if (error) throw error;
      return res.status(200).json({ articles: data || [] });
    }

    if (action === 'upsert') {
      const id = parseInt(body.id) || null;
      const slug = (body.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 100);
      if (!slug) return res.status(400).json({ error: 'Slug requis' });
      const row = {
        slug,
        categorie: (body.categorie || '').trim().slice(0, 100) || null,
        titre:     (body.titre || '').trim().slice(0, 200),
        contenu:   (body.contenu || '').trim().slice(0, 5000),
        ordre:     parseInt(body.ordre) || 0,
        actif:     body.actif !== false,
      };
      if (!row.titre || !row.contenu) return res.status(400).json({ error: 'Titre et contenu requis' });
      const { error } = id
        ? await supabase.from('centre_aide_articles').update(row).eq('id', id)
        : await supabase.from('centre_aide_articles').insert(row);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { error } = await supabase.from('centre_aide_articles').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin aide]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
