const { getSupabase } = require('./_lib/supabase');
const { checkAdminToken } = require('./_lib/auth');
const { EXT_BY_TYPE } = require('./_lib/media');

// Dérive une clé stable (slug) depuis le libellé tapé par l'admin — même
// logique que le slug de ville (admin-cities.js) : émojis/accents retirés,
// tout en minuscules, tirets. "🔑 Clé de secours" -> "cle-de-secours".
function slugifyCategorie(label) {
  return (label || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

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

    // Catégories éditables (Module 10) — jusqu'ici 7 catégories figées dans
    // le code, impossible d'en ajouter une nouvelle sans intervention
    // développeur. "actif:false" garde une catégorie visible (grisée, "Bientôt")
    // sans vidéo dedans, comme Chargement aujourd'hui — jamais supprimée en
    // dur pour ne pas casser les vidéos déjà rattachées à sa clé.
    if (action === 'list_categories') {
      const { data, error } = await supabase
        .from('tuto_categories').select('id, key, label, ordre, actif').order('ordre', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ categories: data || [] });
    }

    if (action === 'create_categorie') {
      const label = (body.label || '').trim().slice(0, 100);
      if (!label) return res.status(400).json({ error: 'Nom du sujet requis' });
      const key = slugifyCategorie(label);
      if (!key) return res.status(400).json({ error: 'Nom invalide' });
      const { data: existing } = await supabase.from('tuto_categories').select('id').eq('key', key).maybeSingle();
      if (existing) return res.status(409).json({ error: 'Un sujet avec ce nom existe déjà' });
      const { data: maxOrdreRow } = await supabase
        .from('tuto_categories').select('ordre').order('ordre', { ascending: false }).limit(1).maybeSingle();
      const ordre = (maxOrdreRow?.ordre || 0) + 1;
      const { data, error } = await supabase
        .from('tuto_categories').insert({ key, label, ordre, actif: true }).select('id, key, label, ordre, actif').single();
      if (error) throw error;
      return res.status(200).json({ ok: true, categorie: data });
    }

    if (action === 'update_categorie') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const patch = {};
      if (body.label != null) {
        const label = body.label.trim().slice(0, 100);
        if (!label) return res.status(400).json({ error: 'Nom du sujet requis' });
        patch.label = label;
      }
      if (body.actif != null) patch.actif = Boolean(body.actif);
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Rien à modifier' });
      const { error } = await supabase.from('tuto_categories').update(patch).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'upsert_meta') {
      const categorie = body.categorie;
      const { data: catRow } = await supabase.from('tuto_categories').select('key').eq('key', categorie).maybeSingle();
      if (!catRow) return res.status(400).json({ error: 'Catégorie invalide' });
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
      const { data: v, error: vErr } = await supabase.from('tutoriel_videos').select('storage_path').eq('id', videoId).maybeSingle();
      if (vErr) throw vErr;
      if (!v || !v.storage_path) return res.status(404).json({ error: 'Fichier introuvable' });
      const { data: urlData, error } = await supabase.storage.from('missions').createSignedUrl(v.storage_path, 3600);
      if (error) throw error;
      return res.status(200).json({ url: urlData.signedUrl });
    }

    if (action === 'demander_upload') {
      const videoId = parseInt(body.video_id);
      if (!videoId) return res.status(400).json({ error: 'video_id manquant' });
      const { data: v, error: vErr2 } = await supabase.from('tutoriel_videos').select('id, categorie').eq('id', videoId).maybeSingle();
      if (vErr2) throw vErr2;
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
      if (!path || !path.startsWith('tutoriels/') || path.includes('..')) return res.status(400).json({ error: 'Fichier invalide' });
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
