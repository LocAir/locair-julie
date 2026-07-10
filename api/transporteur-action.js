const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');
const { sendBrevoSms } = require('./_lib/brevo');
const { computeBareme } = require('./_lib/bareme');

const MEDIA_COLUMN = {
  photo_depart:        'photo_depart_path',
  photo_installation:  'photo_installation_path',
  photo_retour:        'photo_retour_path',
  photo_absence:       'photo_absence_path',
};
// À quelle(s) étape(s) chaque preuve peut être prise. "arrivee" reste accepté
// en plus de "acceptee" par compatibilité avec une mission déjà à cette étape
// au moment du déploiement — le statut n'est plus jamais réémis depuis.
const STAGE_FOR_KIND = {
  photo_depart:       ['acceptee'],
  photo_installation: ['acceptee', 'arrivee'],
  photo_retour:       ['acceptee', 'arrivee'],
};
const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function checkMediaAllowed(liv, kind) {
  const column = MEDIA_COLUMN[kind];
  if (!column) return 'Type de média invalide';
  // La preuve de passage "client absent" peut être prise en route (déjà
  // prévenu, personne ne répond) ou une fois sur place — pas d'étape unique.
  if (kind === 'photo_absence') {
    if (!['acceptee', 'arrivee'].includes(liv.statut)) return 'Cette étape n\'est pas encore accessible';
    return null;
  }
    const expectsLivraison = kind === 'photo_depart' || kind === 'photo_installation';
  if (expectsLivraison && !['livraison', 'changement'].includes(liv.type)) return 'Média non attendu pour cette mission';
  if (kind === 'photo_retour' && !['recuperation', 'changement'].includes(liv.type)) return 'Média non attendu pour cette mission';
  if (!STAGE_FOR_KIND[kind].includes(liv.statut)) return 'Cette étape n\'est pas encore accessible';
  return null;
}

async function loadLivraison(supabase, id) {
  const { data, error } = await supabase
    .from('livraisons')
    .select('*, reservation:reservations(installation, city_id, prenom, tel)')
    .eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const transporteurId = await verifyTransporteurToken(req, supabase);
  if (!transporteurId) return res.status(401).json({ error: 'Session invalide' });

  const body        = req.body || {};
  const action      = body.action;
  const livraisonId = parseInt(body.livraison_id);
  if (!action || !livraisonId) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }

  try {
    const liv = await loadLivraison(supabase, livraisonId);
    if (!liv) return res.status(404).json({ error: 'Mission introuvable' });
    if (liv.transporteur_id !== transporteurId) {
      return res.status(403).json({ error: 'Cette mission ne vous est pas assignée' });
    }

    if (action === 'accepter') {
      if (liv.statut !== 'a_faire') return res.status(409).json({ error: 'Mission déjà traitée' });
      // Une mission commencée doit être terminée avant d'en accepter une autre.
      // Une mission mise en "problème" (ex. client injoignable pour une
      // récupération) ne compte plus comme en cours : le livreur peut passer
      // à la suivante et y revenir plus tard dans la journée.
      const { count } = await supabase
        .from('livraisons').select('id', { count: 'exact', head: true })
        .eq('transporteur_id', transporteurId)
        .in('statut', ['acceptee', 'arrivee'])
        .neq('id', liv.id);
      if (count > 0) {
        return res.status(409).json({ error: 'Termine ta mission en cours avant d\'en accepter une nouvelle.' });
      }
      await supabase.from('livraisons').update({ statut: 'acceptee', accepted_at: new Date().toISOString() }).eq('id', liv.id);
      return res.status(200).json({ ok: true, statut: 'acceptee' });
    }

    if (action === 'indisponible') {
      if (liv.statut !== 'a_faire') return res.status(409).json({ error: 'Mission déjà traitée' });
      await supabase.from('livraisons').update({ statut: 'refusee' }).eq('id', liv.id);
      return res.status(200).json({ ok: true, statut: 'refusee' });
    }

    // Le livreur prévient désormais lui-même par SMS depuis son propre
    // téléphone (bouton côté client, ouvre l'app SMS) — cette action se
    // contente d'horodater "client prévenu" pour les stats de performance.
    if (action === 'prevenir_client') {
      if (!['acceptee', 'arrivee'].includes(liv.statut)) return res.status(409).json({ error: 'Mission pas encore acceptée' });
      if (liv.client_notifie_at) return res.status(200).json({ ok: true });
      await supabase.from('livraisons').update({ client_notifie_at: new Date().toISOString() }).eq('id', liv.id);
      return res.status(200).json({ ok: true });
    }

    if (action === 'demander_upload') {
      const kind = body.kind;
      const mediaErr = checkMediaAllowed(liv, kind);
      if (mediaErr) return res.status(400).json({ error: mediaErr });

      const ext = EXT_BY_TYPE[body.content_type] || 'jpg';
      const path = `${liv.id}/${kind}-${Date.now()}.${ext}`;
      const { data, error } = await supabase.storage.from('missions').createSignedUploadUrl(path, { upsert: true });
      if (error) throw error;
      return res.status(200).json({ ok: true, path: data.path, token: data.token, signedUrl: data.signedUrl });
    }

    if (action === 'confirmer_media') {
      const kind = body.kind;
      const path = (body.path || '').trim();
      const mediaErr = checkMediaAllowed(liv, kind);
      if (mediaErr) return res.status(400).json({ error: mediaErr });
      if (!path || !path.startsWith(`${liv.id}/`)) {
        return res.status(400).json({ error: 'Média invalide' });
      }
      await supabase.from('livraisons').update({ [MEDIA_COLUMN[kind]]: path }).eq('id', liv.id);
      return res.status(200).json({ ok: true });
    }

    if (action === 'confirmer_vidange') {
      if (liv.type !== 'recuperation' || !['acceptee', 'arrivee'].includes(liv.statut)) return res.status(409).json({ error: 'Étape non disponible' });
      await supabase.from('livraisons').update({ vidange_confirmee: true, vidange_at: new Date().toISOString() }).eq('id', liv.id);
      return res.status(200).json({ ok: true });
    }

    if (action === 'livraison_ok' || action === 'retour_ok') {
      const expectedType = action === 'livraison_ok' ? 'livraison' : 'recuperation';
      if (liv.type !== expectedType || !['acceptee', 'arrivee'].includes(liv.statut)) return res.status(409).json({ error: 'Étape non disponible' });
      if (expectedType === 'livraison' && !liv.photo_installation_path) {
        return res.status(400).json({ error: 'Photo d\'installation requise avant de valider' });
      }
      if (expectedType === 'recuperation' && !liv.photo_retour_path) {
        return res.status(400).json({ error: 'Photo de l\'appareil récupéré requise avant de valider' });
      }
      if (expectedType === 'recuperation' && !liv.vidange_confirmee) {
        return res.status(400).json({ error: 'Vérification et vidange requises avant de valider' });
      }

      const montantDu = computeBareme(liv.type, liv.reservation?.installation);

      await supabase.from('livraisons').update({
        statut: 'fait', fait_at: new Date().toISOString(), montant_du_cents: montantDu,
      }).eq('id', liv.id);

      if (expectedType === 'recuperation') {
        await supabase.from('reservations').update({ statut: 'terminee' }).eq('id', liv.reservation_id);
      }

      return res.status(200).json({ ok: true, statut: 'fait', montant_du_cents: montantDu });
    }

    if (action === 'changement_ok') {
      if (liv.type !== 'changement' || !['acceptee', 'arrivee'].includes(liv.statut)) return res.status(409).json({ error: 'Étape non disponible' });
      if (!liv.photo_installation_path) return res.status(400).json({ error: 'Photo du nouvel appareil installé requise avant de valider' });
      if (!liv.photo_retour_path) return res.status(400).json({ error: 'Photo de l\'ancien appareil récupéré requise avant de valider' });
      if (!liv.vidange_confirmee) return res.status(400).json({ error: 'Vidange de l\'ancien appareil requise avant de valider' });

      const montantDu = computeBareme('changement', null);

      await supabase.from('livraisons').update({
        statut: 'fait', fait_at: new Date().toISOString(), montant_du_cents: montantDu,
      }).eq('id', liv.id);

      return res.status(200).json({ ok: true, statut: 'fait', montant_du_cents: montantDu });
    }

    if (action === 'probleme') {
      const problemeType = ['client_absent', 'appareil_en_panne', 'retard', 'autre'].includes(body.probleme_type) ? body.probleme_type : 'autre';
      const description  = (body.probleme_description || '').slice(0, 1000);

      // "Client absent" exige la preuve de passage (photo prise juste avant) —
      // sans quoi le SMS automatique pourrait partir sans rien qui le justifie.
      if (problemeType === 'client_absent' && !liv.photo_absence_path) {
        return res.status(400).json({ error: 'Photo de passage requise avant de signaler un client absent' });
      }

      await supabase.from('livraisons').update({
        statut:               'probleme',
        probleme_type:        problemeType,
        probleme_description: description,
        probleme_at:          new Date().toISOString(),
      }).eq('id', liv.id);

      const incidentType = problemeType === 'retard' ? 'retard' : problemeType === 'appareil_en_panne' ? 'materiel' : 'autre';
      // La mission a toujours une réservation d'origine — sa city_id est la
      // source de vérité, jamais une ville devinée (voir charge-retard.js).
      const { data: resaCity } = await supabase
        .from('reservations').select('city_id').eq('id', liv.reservation_id).maybeSingle();
      await supabase.from('incidents').insert({
        city_id:         resaCity?.city_id || null,
        reservation_id: liv.reservation_id,
        type:            incidentType,
        description:     `[${liv.type}] ${description || problemeType}`,
        statut:          'ouvert',
      });

      if (problemeType === 'client_absent') {
        const { data: resa } = await supabase
          .from('reservations').select('prenom, tel').eq('id', liv.reservation_id).maybeSingle();
        if (resa?.tel) {
          const verbe = liv.type === 'livraison' ? 'livrer' : 'récupérer';
          await sendBrevoSms({
            to: resa.tel,
            content: `Loc'Air : notre livreur est passé pour ${verbe} votre climatiseur mais personne ne répondait. Merci de nous rappeler pour reprogrammer.`,
          }).catch(() => {});
        }
      }

      return res.status(200).json({ ok: true, statut: 'probleme' });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Transporteur action]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
