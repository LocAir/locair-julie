const { getSupabase } = require('./_lib/supabase');
const { checkTransporteurToken } = require('./_lib/auth');

const MEDIA_COLUMN = {
  photo_depart:        'photo_depart_path',
  video_installation:  'video_installation_path',
  photo_retour:        'photo_retour_path',
};
const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

async function loadLivraison(supabase, id) {
  const { data, error } = await supabase.from('livraisons').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkTransporteurToken(req)) return res.status(401).json({ error: 'Code incorrect' });

  const body            = req.body || {};
  const action          = body.action;
  const livraisonId     = parseInt(body.livraison_id);
  const transporteurId  = parseInt(body.transporteur_id);
  if (!action || !livraisonId || !transporteurId) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }

  const supabase = getSupabase();

  try {
    const liv = await loadLivraison(supabase, livraisonId);
    if (!liv) return res.status(404).json({ error: 'Mission introuvable' });
    if (liv.transporteur_id !== transporteurId) {
      return res.status(403).json({ error: 'Cette mission ne vous est pas assignée' });
    }

    if (action === 'accepter') {
      if (liv.statut !== 'a_faire') return res.status(409).json({ error: 'Mission déjà traitée' });
      await supabase.from('livraisons').update({ statut: 'acceptee', accepted_at: new Date().toISOString() }).eq('id', liv.id);
      return res.status(200).json({ ok: true, statut: 'acceptee' });
    }

    if (action === 'indisponible') {
      if (liv.statut !== 'a_faire') return res.status(409).json({ error: 'Mission déjà traitée' });
      await supabase.from('livraisons').update({ statut: 'refusee' }).eq('id', liv.id);
      return res.status(200).json({ ok: true, statut: 'refusee' });
    }

    if (action === 'arrive') {
      if (liv.statut !== 'acceptee') return res.status(409).json({ error: 'Mission pas encore acceptée' });
      if (liv.type === 'livraison' && !liv.photo_depart_path) {
        return res.status(400).json({ error: 'Photo de l\'appareil au départ dépôt requise avant de partir' });
      }
      await supabase.from('livraisons').update({ statut: 'arrivee', arrivee_at: new Date().toISOString() }).eq('id', liv.id);
      return res.status(200).json({ ok: true, statut: 'arrivee' });
    }

    if (action === 'demander_upload') {
      const kind = body.kind;
      const column = MEDIA_COLUMN[kind];
      if (!column) return res.status(400).json({ error: 'Type de média invalide' });
      const expectsLivraison = kind === 'photo_depart' || kind === 'video_installation';
      if (expectsLivraison && liv.type !== 'livraison') return res.status(400).json({ error: 'Média non attendu pour cette mission' });
      if (kind === 'photo_retour' && liv.type !== 'recuperation') return res.status(400).json({ error: 'Média non attendu pour cette mission' });

      const ext = EXT_BY_TYPE[body.content_type] || (kind === 'video_installation' ? 'mp4' : 'jpg');
      const path = `${liv.id}/${kind}-${Date.now()}.${ext}`;
      const { data, error } = await supabase.storage.from('missions').createSignedUploadUrl(path, { upsert: true });
      if (error) throw error;
      return res.status(200).json({ ok: true, path: data.path, token: data.token, signedUrl: data.signedUrl });
    }

    if (action === 'confirmer_media') {
      const kind = body.kind;
      const column = MEDIA_COLUMN[kind];
      const path = (body.path || '').trim();
      if (!column || !path || !path.startsWith(`${liv.id}/`)) {
        return res.status(400).json({ error: 'Média invalide' });
      }
      await supabase.from('livraisons').update({ [column]: path }).eq('id', liv.id);
      return res.status(200).json({ ok: true });
    }

    if (action === 'livraison_ok' || action === 'retour_ok') {
      const expectedType = action === 'livraison_ok' ? 'livraison' : 'recuperation';
      if (liv.type !== expectedType || liv.statut !== 'arrivee') return res.status(409).json({ error: 'Étape non disponible' });
      if (expectedType === 'livraison' && (!liv.photo_depart_path || !liv.video_installation_path)) {
        return res.status(400).json({ error: 'Photo de départ et vidéo d\'installation requises avant de valider' });
      }
      if (expectedType === 'recuperation' && !liv.photo_retour_path) {
        return res.status(400).json({ error: 'Photo de l\'appareil récupéré requise avant de valider' });
      }

      const { data: transp } = await supabase
        .from('transporteurs').select('taux_livraison_cents, taux_recuperation_cents').eq('id', transporteurId).maybeSingle();
      const montantDu = expectedType === 'livraison'
        ? (transp?.taux_livraison_cents || 0)
        : (transp?.taux_recuperation_cents || 0);

      await supabase.from('livraisons').update({
        statut: 'fait', fait_at: new Date().toISOString(), montant_du_cents: montantDu,
      }).eq('id', liv.id);

      // Une récupération confirmée libère le stock immédiatement (retour anticipé
      // ou à la date prévue), sans attendre que date_fin soit dans le passé.
      if (expectedType === 'recuperation') {
        await supabase.from('reservations').update({ statut: 'terminee' }).eq('id', liv.reservation_id);
      }

      return res.status(200).json({ ok: true, statut: 'fait', montant_du_cents: montantDu });
    }

    if (action === 'probleme') {
      const problemeType = ['client_injoignable', 'appareil_en_panne', 'retard', 'autre'].includes(body.probleme_type) ? body.probleme_type : 'autre';
      const description  = (body.probleme_description || '').slice(0, 1000);
      await supabase.from('livraisons').update({
        statut:               'probleme',
        probleme_type:        problemeType,
        probleme_description: description,
        probleme_at:          new Date().toISOString(),
      }).eq('id', liv.id);

      const incidentType = problemeType === 'retard' ? 'retard' : problemeType === 'appareil_en_panne' ? 'materiel' : 'autre';
      await supabase.from('incidents').insert({
        reservation_id: liv.reservation_id,
        type:            incidentType,
        description:     `[${liv.type}] ${description || problemeType}`,
        statut:          'ouvert',
      });

      return res.status(200).json({ ok: true, statut: 'probleme' });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Transporteur action]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
