const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const transporteurId = await verifyTransporteurToken(req, supabase);
  if (!transporteurId) return res.status(401).json({ error: 'Session invalide' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    if (action === 'list') {
      const { data: videos, error } = await supabase
        .from('tutoriel_videos')
        .select('id, categorie, sous_categorie, titre, ordre, storage_path, actif')
        .eq('actif', true)
        .order('categorie', { ascending: true })
        .order('ordre', { ascending: true });
      if (error) throw error;

      const { data: vus, error: vusErr } = await supabase
        .from('tutoriel_vus').select('video_id').eq('transporteur_id', transporteurId);
      if (vusErr) throw vusErr;
      const vuIds = new Set((vus || []).map(v => v.video_id));

      const list = (videos || []).map(v => ({
        id: v.id, categorie: v.categorie, sous_categorie: v.sous_categorie, titre: v.titre,
        ordre: v.ordre, disponible: Boolean(v.storage_path), deja_vu: vuIds.has(v.id),
      }));
      return res.status(200).json({ videos: list });
    }

    if (action === 'video_url') {
      const videoId = parseInt(body.video_id);
      if (!videoId) return res.status(400).json({ error: 'video_id manquant' });
      const { data: v } = await supabase
        .from('tutoriel_videos').select('storage_path, actif').eq('id', videoId).maybeSingle();
      if (!v || !v.actif || !v.storage_path) return res.status(404).json({ error: 'Vidéo indisponible' });
      // Expiration longue (1h) : contrairement aux preuves de mission (300s),
      // une vidéo de plusieurs minutes doit rester lisible tout le visionnage.
      const { data: urlData, error } = await supabase.storage
        .from('missions').createSignedUrl(v.storage_path, 3600);
      if (error) throw error;
      return res.status(200).json({ url: urlData.signedUrl });
    }

    if (action === 'marquer_vu') {
      const videoId = parseInt(body.video_id);
      if (!videoId) return res.status(400).json({ error: 'video_id manquant' });
      const { data: v } = await supabase
        .from('tutoriel_videos').select('id, actif').eq('id', videoId).maybeSingle();
      if (!v || !v.actif) return res.status(404).json({ error: 'Vidéo introuvable' });
      const { error } = await supabase.from('tutoriel_vus')
        .upsert({ transporteur_id: transporteurId, video_id: videoId, vu_complet_at: new Date().toISOString() }, { onConflict: 'transporteur_id,video_id' });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Transporteur tutoriels]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
