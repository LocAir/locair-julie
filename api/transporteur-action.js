const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');
const { sendBrevoSms, sendBrevoEmail } = require('./_lib/brevo');
const { computeBareme, getBaremeForCity } = require('./_lib/bareme');
const { pushToAdmin, pushToTransporteur } = require('./_lib/push');
const { pickTransporteurForMission } = require('./_lib/reservations');

const PROBLEME_LABEL = {
  client_absent:     'Client absent',
  appareil_en_panne: 'Appareil en panne',
  retard:            'Retard',
  autre:             'Problème',
};

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
const EXT_BY_TYPE = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
};

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
    .select('*, reservation:reservations(installation, city_id, prenom, nom, tel, email, ref, adresse, creneau)')
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

      // SMS client : prise en charge confirmée
      if (liv.reservation?.tel) {
        const dateStr = new Date(liv.date_prevue + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
        const verbe = liv.type === 'recuperation' ? 'récupérer votre climatiseur' : 'vous livrer votre climatiseur';
        await sendBrevoSms({
          to: liv.reservation.tel,
          content: `Loc'Air : votre mission du ${dateStr} est confirmée, notre technicien viendra ${verbe}. Il vous contactera 30 min avant. Questions : 06 63 79 87 56`,
        }).catch(() => {});
      }

      return res.status(200).json({ ok: true, statut: 'acceptee' });
    }

    if (action === 'indisponible') {
      if (liv.statut !== 'a_faire') return res.status(409).json({ error: 'Mission déjà traitée' });

      // Tenter une réassignation automatique avant de marquer refusée
      let reassigned = false;
      if (liv.reservation) {
        const newTid = await pickTransporteurForMission(supabase, {
          cityId:      liv.reservation.city_id,
          dateISO:     liv.date_prevue,
          creneau:     liv.creneau || liv.reservation.creneau,
          adresse:     liv.reservation.adresse,
          usedInBatch: new Set([transporteurId]),
          type:        liv.type,
          installation: liv.reservation.installation,
        });
        if (newTid && newTid !== transporteurId) {
          await supabase.from('livraisons').update({ transporteur_id: newTid, statut: 'a_faire' }).eq('id', liv.id);
          await pushToTransporteur(supabase, newTid, {
            title: "Nouvelle mission Loc'Air",
            body:  "Une mission vous a été réassignée — ouvre l'app pour l'accepter.",
            tag:   'nouvelle-mission',
          });
          reassigned = true;
        }
      }

      if (!reassigned) {
        await supabase.from('livraisons').update({ statut: 'refusee' }).eq('id', liv.id);
        await pushToAdmin(supabase, {
          title: '⚠️ Mission sans transporteur',
          body:  'Un transporteur a refusé une mission et aucun remplaçant disponible — assigne manuellement.',
          tag:   'mission-non-couverte',
        });
      }

      return res.status(200).json({ ok: true, statut: reassigned ? 'reassigne' : 'refusee' });
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

      const ext = EXT_BY_TYPE[body.content_type] || 'mp4';
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

    // Photos/vidéos supplémentaires (galerie libre, pas de preuve obligatoire
    // remplacée) — disponibles à n'importe quelle étape d'une mission en
    // cours, prises en direct ou choisies dans la galerie du téléphone.
    if (action === 'demander_upload_supp') {
      const type = body.type === 'video' ? 'video' : 'photo';
      const ext = EXT_BY_TYPE[body.content_type] || (type === 'video' ? 'mp4' : 'jpg');
      const rand = Math.random().toString(36).slice(2, 8);
      const path = `${liv.id}/supp-${Date.now()}-${rand}.${ext}`;
      const { data, error } = await supabase.storage.from('missions').createSignedUploadUrl(path, { upsert: true });
      if (error) throw error;
      return res.status(200).json({ ok: true, path: data.path, token: data.token, signedUrl: data.signedUrl });
    }

    if (action === 'confirmer_media_supp') {
      const type = body.type === 'video' ? 'video' : 'photo';
      const path = (body.path || '').trim();
      if (!path || !path.startsWith(`${liv.id}/supp-`)) {
        return res.status(400).json({ error: 'Média invalide' });
      }
      const { data, error } = await supabase.from('mission_medias')
        .insert({ livraison_id: liv.id, type, path, uploaded_by: 'transporteur' })
        .select().single();
      if (error) throw error;
      return res.status(200).json({ ok: true, media: data });
    }

    if (action === 'media_url_supp') {
      const mediaId = parseInt(body.media_id);
      if (!mediaId) return res.status(400).json({ error: 'media_id manquant' });
      const { data: media } = await supabase.from('mission_medias').select('id, path').eq('id', mediaId).eq('livraison_id', liv.id).maybeSingle();
      if (!media) return res.status(404).json({ error: 'Média introuvable' });
      const { data, error } = await supabase.storage.from('missions').createSignedUrl(media.path, 300);
      if (error) throw error;
      return res.status(200).json({ url: data.signedUrl });
    }

    if (action === 'supprimer_media_supp') {
      const mediaId = parseInt(body.media_id);
      if (!mediaId) return res.status(400).json({ error: 'media_id manquant' });
      const { data: media } = await supabase.from('mission_medias').select('id, path').eq('id', mediaId).eq('livraison_id', liv.id).maybeSingle();
      if (!media) return res.status(404).json({ error: 'Média introuvable' });
      await supabase.storage.from('missions').remove([media.path]).catch(() => {});
      await supabase.from('mission_medias').delete().eq('id', mediaId);
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
        return res.status(400).json({ error: 'Vidéo d\'installation requise avant de valider' });
      }
      if (expectedType === 'recuperation' && !liv.photo_retour_path) {
        return res.status(400).json({ error: 'Vidéo de l\'appareil récupéré requise avant de valider' });
      }
      if (expectedType === 'recuperation' && !liv.vidange_confirmee) {
        return res.status(400).json({ error: 'Vérification et vidange requises avant de valider' });
      }

      const tarifs = await getBaremeForCity(supabase, liv.reservation?.city_id);
      const montantDu = computeBareme(liv.type, liv.reservation?.installation, tarifs);

      await supabase.from('livraisons').update({
        statut: 'fait', fait_at: new Date().toISOString(), montant_du_cents: montantDu,
      }).eq('id', liv.id);

      if (expectedType === 'recuperation') {
        await supabase.from('reservations').update({ statut: 'terminee' }).eq('id', liv.reservation_id);

        // Email de fin de location au client
        if (liv.reservation?.email) {
          const prenom = liv.reservation.prenom || '';
          const ref    = liv.reservation.ref    || '';
          await sendBrevoEmail({
            to:      liv.reservation.email,
            subject: `Loc'Air — Location terminée · Merci ${prenom} !`,
            html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font-family:Inter,Arial,sans-serif;background:#f4f0ea;margin:0;padding:0}
.wrap{max-width:560px;margin:16px auto;background:#fff;border-radius:16px;overflow:hidden}
.head{background:#1b3a5f;padding:28px 32px;text-align:center}
.head h1{color:#fff;font-size:20px;margin:0}
.body{padding:28px 32px;font-size:14px;color:#333;line-height:1.6;text-align:center}
.footer{background:#f4f0ea;padding:20px 32px;text-align:center;font-size:12px;color:#888}
.btn{display:inline-block;background:#f59e0b;color:#fff;padding:14px 32px;border-radius:100px;text-decoration:none;font-weight:700;font-size:15px;margin:16px 0}
</style></head><body>
<div class="wrap">
<div class="head"><h1>✅ Location terminée</h1></div>
<div class="body">
<p>Bonjour ${prenom},</p>
<p>Notre technicien a récupéré votre climatiseur. Merci d'avoir choisi Loc'Air !</p>
<p style="font-size:13px;color:#666">Dossier ${ref}</p>
<p style="margin:8px 0 0;font-size:13px;color:#444">Si vous avez une minute, votre avis aide d'autres Niçois à nous faire confiance :</p>
<a class="btn" href="https://g.page/r/CeJQrt2gLNNrEAE/review">Laisser un avis Google ⭐</a>
<p style="font-size:12px;color:#999">À très bientôt !</p>
</div>
<div class="footer">© 2026 Loc'Air · <a href="https://www.locair.fr" style="color:#1b3a5f">www.locair.fr</a></div>
</div></body></html>`,
          }).catch(() => {});
        }
      }

      return res.status(200).json({ ok: true, statut: 'fait', montant_du_cents: montantDu });
    }

    if (action === 'changement_ok') {
      if (liv.type !== 'changement' || !['acceptee', 'arrivee'].includes(liv.statut)) return res.status(409).json({ error: 'Étape non disponible' });
      if (!liv.photo_installation_path) return res.status(400).json({ error: 'Vidéo du nouvel appareil installé requise avant de valider' });
      if (!liv.photo_retour_path) return res.status(400).json({ error: 'Vidéo de l\'ancien appareil récupéré requise avant de valider' });
      if (!liv.vidange_confirmee) return res.status(400).json({ error: 'Vidange de l\'ancien appareil requise avant de valider' });

      const tarifs = await getBaremeForCity(supabase, liv.reservation?.city_id);
      const montantDu = computeBareme('changement', null, tarifs);

      await supabase.from('livraisons').update({
        statut: 'fait', fait_at: new Date().toISOString(), montant_du_cents: montantDu,
      }).eq('id', liv.id);

      return res.status(200).json({ ok: true, statut: 'fait', montant_du_cents: montantDu });
    }

    if (action === 'probleme') {
      const problemeType = ['client_absent', 'appareil_en_panne', 'retard', 'autre'].includes(body.probleme_type) ? body.probleme_type : 'autre';
      const description  = (body.probleme_description || '').slice(0, 1000);

      // "Client absent" exige la preuve de passage (vidéo prise juste avant) —
      // sans quoi le SMS automatique pourrait partir sans rien qui le justifie.
      if (problemeType === 'client_absent' && !liv.photo_absence_path) {
        return res.status(400).json({ error: 'Vidéo de passage requise avant de signaler un client absent' });
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

      await pushToAdmin(supabase, {
        title: `🧯 ${PROBLEME_LABEL[problemeType] || 'Problème'} signalé`,
        body:  description || 'Un livreur a signalé un problème sur une mission — ouvre l\'app pour voir le détail.',
        tag:   'incident',
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

    if (action === 'fenetre_photo_url') {
      const { data: liv2 } = await supabase
        .from('livraisons')
        .select('reservation:reservations(fenetre_photo_path)')
        .eq('id', livraisonId).eq('transporteur_id', transporteurId).maybeSingle();
      if (!liv2?.reservation?.fenetre_photo_path) return res.status(404).json({ error: 'Photo introuvable' });
      const { data: urlData, error: urlErr } = await supabase.storage
        .from('missions').createSignedUrl(liv2.reservation.fenetre_photo_path, 300);
      if (urlErr) throw urlErr;
      return res.status(200).json({ url: urlData.signedUrl });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Transporteur action]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
