const { getSupabase } = require('./_lib/supabase');
const { getCity }     = require('./_lib/city');
const { verifyTransporteurToken } = require('./_lib/auth');
const { sendBrevoEmail, sendBrevoSms } = require('./_lib/brevo');
const { geocodeAddress, haversineKm } = require('./_lib/geo');

// Estime le temps d'arrivée réel à partir de la dernière position GPS connue
// du livreur (partagée pendant une mission en cours) — pour ne plus annoncer
// systématiquement "~30 min" à un client alors que le livreur est à 5 min.
// Si la position est absente/trop ancienne ou le géocodage échoue, retourne
// null : l'appelant retombe alors sur le message générique existant.
async function estimateEtaMinutes(supabase, transporteurId, adresse) {
  if (!transporteurId || !adresse) return null;
  try {
    const { data: t } = await supabase
      .from('transporteurs').select('position_lat, position_lng, position_at').eq('id', transporteurId).maybeSingle();
    if (!t || t.position_lat == null || t.position_lng == null || !t.position_at) return null;
    const ageMin = (Date.now() - new Date(t.position_at).getTime()) / 60000;
    if (ageMin > 10) return null;
    const dest = await geocodeAddress(adresse);
    if (!dest) return null;
    const km = haversineKm(t.position_lat, t.position_lng, dest.lat, dest.lng);
    return Math.max(3, Math.min(60, Math.round(km / 22 * 60))); // ~22km/h en ville, estimation, pas de trafic réel
  } catch (e) {
    return null;
  }
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const MEDIA_COLUMN = {
  photo_depart:        'photo_depart_path',
  photo_installation:  'photo_installation_path',
  photo_retour:        'photo_retour_path',
  photo_absence:       'photo_absence_path',
};
// À quelle étape chaque preuve peut être prise — empêche de brûler une étape
// (ex. photographier l'installation avant même d'être arrivé chez le client).
const STAGE_FOR_KIND = {
  photo_depart:       'acceptee',
  photo_installation: 'arrivee',
  photo_retour:       'arrivee',
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
  if (expectsLivraison && liv.type !== 'livraison') return 'Média non attendu pour cette mission';
  if (kind === 'photo_retour' && liv.type !== 'recuperation') return 'Média non attendu pour cette mission';
  if (liv.statut !== STAGE_FOR_KIND[kind]) return 'Cette étape n\'est pas encore accessible';
  return null;
}

async function loadLivraison(supabase, id) {
  const { data, error } = await supabase.from('livraisons').select('*').eq('id', id).maybeSingle();
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

    if (action === 'prevenir_client') {
      if (liv.statut !== 'acceptee') return res.status(409).json({ error: 'Mission pas encore acceptée' });
      if (liv.client_notifie_at) return res.status(200).json({ ok: true });

      const { data: resa } = await supabase
        .from('reservations').select('prenom, email, adresse').eq('id', liv.reservation_id).maybeSingle();
      await supabase.from('livraisons').update({ client_notifie_at: new Date().toISOString() }).eq('id', liv.id);

      if (resa?.email) {
        const verbe = liv.type === 'livraison' ? 'livrer votre climatiseur' : 'récupérer votre climatiseur';
        const etaMin = await estimateEtaMinutes(supabase, liv.transporteur_id, resa.adresse);
        const etaTxt = etaMin ? `environ ${etaMin} minute${etaMin > 1 ? 's' : ''}` : 'environ 30 minutes';
        await sendBrevoEmail({
          to:      resa.email,
          subject: `📦 Votre livreur Loc'Air arrive dans ${etaTxt}`,
          html: `<p>Bonjour ${escHtml(resa.prenom || '')},</p>
                 <p>Notre livreur est en route pour ${verbe} — il devrait arriver d'ici ${etaTxt} à l'adresse :</p>
                 <p><strong>${escHtml(resa.adresse || '')}</strong></p>
                 <p>Merci d'être disponible pour le réceptionner.</p>`,
        }).catch(() => {});
      }

      return res.status(200).json({ ok: true });
    }

    if (action === 'arrive') {
      if (liv.statut !== 'acceptee') return res.status(409).json({ error: 'Mission pas encore acceptée' });
      if (!liv.client_notifie_at) {
        return res.status(400).json({ error: 'Préviens le client avant d\'arriver chez lui' });
      }
      await supabase.from('livraisons').update({ statut: 'arrivee', arrivee_at: new Date().toISOString() }).eq('id', liv.id);
      return res.status(200).json({ ok: true, statut: 'arrivee' });
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
      if (liv.type !== 'recuperation' || liv.statut !== 'arrivee') return res.status(409).json({ error: 'Étape non disponible' });
      await supabase.from('livraisons').update({ vidange_confirmee: true, vidange_at: new Date().toISOString() }).eq('id', liv.id);
      return res.status(200).json({ ok: true });
    }

    if (action === 'livraison_ok' || action === 'retour_ok') {
      const expectedType = action === 'livraison_ok' ? 'livraison' : 'recuperation';
      if (liv.type !== expectedType || liv.statut !== 'arrivee') return res.status(409).json({ error: 'Étape non disponible' });
      if (expectedType === 'livraison' && !liv.photo_installation_path) {
        return res.status(400).json({ error: 'Photo d\'installation requise avant de valider' });
      }
      if (expectedType === 'recuperation' && !liv.photo_retour_path) {
        return res.status(400).json({ error: 'Photo de l\'appareil récupéré requise avant de valider' });
      }
      if (expectedType === 'recuperation' && !liv.vidange_confirmee) {
        return res.status(400).json({ error: 'Vérification et vidange requises avant de valider' });
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
      const city = await getCity(supabase).catch(() => null);
      await supabase.from('incidents').insert({
        city_id:         city?.id || null,
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
