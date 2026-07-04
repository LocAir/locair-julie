const { getSupabase } = require('./_lib/supabase');
const { checkAdminToken } = require('./_lib/auth');

const MEDIA_COLUMN = {
  photo_depart:       'photo_depart_path',
  video_installation: 'video_installation_path',
  photo_retour:       'photo_retour_path',
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    if (action === 'list') {
      const { data, error } = await supabase
        .from('livraisons')
        .select(`
          id, type, statut, date_prevue, creneau,
          probleme_type, probleme_description,
          photo_depart_path, video_installation_path, photo_retour_path,
          transporteur:transporteurs ( id, nom ),
          reservation:reservations ( id, ref, prenom, nom, tel, adresse, etage, ascenseur, fenetre )
        `)
        .order('date_prevue', { ascending: false })
        .limit(300);
      if (error) throw error;
      return res.status(200).json({ livraisons: data || [] });
    }

    if (action === 'resolve_probleme') {
      const livraisonId = parseInt(body.livraison_id);
      if (!livraisonId) return res.status(400).json({ error: 'livraison_id manquant' });
      const { data: liv } = await supabase.from('livraisons').select('id, statut, reservation_id').eq('id', livraisonId).maybeSingle();
      if (!liv) return res.status(404).json({ error: 'Mission introuvable' });
      if (liv.statut !== 'probleme') return res.status(409).json({ error: 'Cette mission n\'est pas signalée en problème' });

      // Remet la mission à l'étape "acceptée" : le livreur doit repasser par "arrivé"
      // (sans reperdre les preuves déjà prises) avant de pouvoir la terminer.
      await supabase.from('livraisons').update({
        statut: 'acceptee', probleme_type: null, probleme_description: null, probleme_at: null,
      }).eq('id', liv.id);

      if (liv.reservation_id) {
        await supabase.from('incidents').update({ statut: 'resolu' })
          .eq('reservation_id', liv.reservation_id).eq('statut', 'ouvert');
      }

      return res.status(200).json({ ok: true });
    }

    if (action === 'assign') {
      const livraisonId    = parseInt(body.livraison_id);
      const transporteurId = body.transporteur_id ? parseInt(body.transporteur_id) : null;
      if (!livraisonId) return res.status(400).json({ error: 'livraison_id manquant' });
      const { error } = await supabase.from('livraisons').update({ transporteur_id: transporteurId }).eq('id', livraisonId);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'position') {
      const transporteurId = parseInt(body.transporteur_id);
      if (!transporteurId) return res.status(400).json({ error: 'transporteur_id manquant' });
      const { data: t, error } = await supabase
        .from('transporteurs').select('nom, position_lat, position_lng, position_at')
        .eq('id', transporteurId).maybeSingle();
      if (error) throw error;
      if (!t || t.position_lat == null) return res.status(404).json({ error: 'Pas encore de position' });
      return res.status(200).json({ nom: t.nom, lat: t.position_lat, lng: t.position_lng, position_at: t.position_at });
    }

    if (action === 'media_url') {
      const livraisonId = parseInt(body.livraison_id);
      const kind = body.kind;
      const column = MEDIA_COLUMN[kind];
      if (!livraisonId || !column) return res.status(400).json({ error: 'Paramètres invalides' });
      const { data: liv } = await supabase.from('livraisons').select(column).eq('id', livraisonId).maybeSingle();
      if (!liv || !liv[column]) return res.status(404).json({ error: 'Média introuvable' });
      const { data, error } = await supabase.storage.from('missions').createSignedUrl(liv[column], 300);
      if (error) throw error;
      return res.status(200).json({ url: data.signedUrl });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin livraisons]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
