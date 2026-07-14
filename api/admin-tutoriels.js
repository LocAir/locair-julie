const { getSupabase } = require('./_lib/supabase');
const { checkAdminToken } = require('./_lib/auth');
const { EXT_BY_TYPE } = require('./_lib/media');

const CATEGORIES = [
  'acces_sortie_boxe', 'recuperation_materiel', 'fermeture_boxe',
  'entree_sortie_centre', 'chargement', 'dechargement', 'installation',
];

// Bibliothèque de tutoriels vidéo — pas de resolveAdminCity : contrairement
// au reste de l'admin (villes, stock, réservations...), cette bibliothèque
// est unique et partagée par toutes les villes, comme les identifiants
// admin ou les abonnements push (mêmes fichiers de référence :
// admin-login.js, admin-push-subscribe.js).
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    if (action === 'list') {
      const { data, error } = await supabase
        .from('tutoriel_videos')
        .select('id, categorie, sous_categorie, titre, storage_path, ordre, actif')
        .order('categorie', { ascending: true })
        .order('ordre', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ videos: data || [] });
    }

    if (action === 'upsert_meta') {
      const categorie = body.categorie;
      if (!CATEGORIES.includes(categorie)) return res.status(400).json({ error: 'Catégorie invalide' });
      const titre = (body.titre || '').trim().slice(0, 200);
      if (!titre) return res.status(400).json({ error: 'Titre requis' });
      const patch = {
        categorie, titre,
        sous_categorie: (body.sous_categorie || '').trim().slice(0, 100) || null,
        ordre: Math.max(0, parseInt(body.ordre) || 0),
        actif: body.actif !== false,
      };
      const id = parseInt(body.id);
      if (id) {
        const { error } = await supabase.from('tutoriel_videos').update(patch).eq('id', id);
        if (error) throw error;
        return res.status(200).json({ ok: true, id });
      }
      const { data, error } = await supabase.from('tutoriel_videos').insert(patch).select('id').single();
      if (error) throw error;
      return res.status(200).json({ ok: true, id: data.id });
    }

    if (action === 'video_url') {
      const videoId = parseInt(body.video_id);
      if (!videoId) return res.status(400).json({ error: 'video_id manquant' });
      const { data: v } = await supabase.from('tutoriel_videos').select('storage_path').eq('id', videoId).maybeSingle();
      if (!v || !v.storage_path) return res.status(404).json({ error: 'Fichier introuvable' });
      const { data: urlData, error } = await supabase.storage.from('missions').createSignedUrl(v.storage_path, 3600);
      if (error) throw error;
      return res.status(200).json({ url: urlData.signedUrl });
    }

    if (action === 'demander_upload') {
      const videoId = parseInt(body.video_id);
      if (!videoId) return res.status(400).json({ error: 'video_id manquant' });
      const { data: v } = await supabase.from('tutoriel_videos').select('id, categorie').eq('id', videoId).maybeSingle();
      if (!v) return res.status(404).json({ error: 'Vidéo introuvable' });

      const ext = EXT_BY_TYPE[body.content_type] || 'mp4';
      const path = `tutoriels/${v.categorie}/${v.id}-${Date.now()}.${ext}`;
      const { data, error } = await supabase.storage.from('missions').createSignedUploadUrl(path, { upsert: true });
      if (error) throw error;
      return res.status(200).json({ ok: true, path: data.path, token: data.token, signedUrl: data.signedUrl });
    }

    if (action === 'confirmer_upload') {
      const videoId = parseInt(body.video_id);
      const path = (body.path || '').trim();
      if (!videoId) return res.status(400).json({ error: 'video_id manquant' });
      if (!path || !path.startsWith('tutoriels/')) return res.status(400).json({ error: 'Fichier invalide' });
      const { error } = await supabase.from('tutoriel_videos').update({ storage_path: path }).eq('id', videoId);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      // Le fichier dans le bucket n'est pas supprimé (comme pour les preuves
      // de mission, rien ne nettoie jamais le bucket 'missions' dans ce repo)
      // — et l'historique "vu" pour cette vidéo disparaît avec elle (cascade).
      const { error } = await supabase.from('tutoriel_videos').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin tutoriels]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
