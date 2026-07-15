const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');
const { sendBrevoSms } = require('./_lib/brevo');
const { computeBareme, getBaremeForCity } = require('./_lib/bareme');
const { pushToAdmin, pushToTransporteur } = require('./_lib/push');
const { pickTransporteurForMission } = require('./_lib/reservations');
const { EXT_BY_TYPE } = require('./_lib/media');
const { sendScenarioEmail } = require('./_lib/emailEngine');

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

// Accepter une mission n'est pas la démarrer : ça peut se faire n'importe
// quand, même en avance. Seules les étapes de terrain (photo/vidéo, vidange,
// validation finale, signalement) exigent que le jour prévu soit arrivé —
// vérifié ici, source de vérité serveur, en plus du gate côté client.
function missionStartDateError(liv) {
  const todayStr = new Date().toISOString().slice(0, 10);
  if (liv.date_prevue > todayStr) {
    const dateLabel = new Date(liv.date_prevue + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return `Cette mission ne peut être démarrée que le ${dateLabel}.`;
  }
  return null;
}

function checkMediaAllowed(liv, kind) {
  const column = MEDIA_COLUMN[kind];
  if (!column) return 'Type de média invalide';
  const dateErr = missionStartDateError(liv);
  if (dateErr) return dateErr;
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

// Si cette mission avait déclenché un incident (client absent, retard...) et
// qu'elle se termine normalement, referme cet incident précis — sans toucher
// à un incident déjà facturé ou déjà résolu par ailleurs.
async function closeMissionIncident(supabase, liv) {
  if (!liv.incident_id) return;
  await supabase.from('incidents').update({ statut: 'resolu' }).eq('id', liv.incident_id).eq('statut', 'ouvert');
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
      // Accepter n'est pas démarrer : possible n'importe quand, même en
      // avance — c'est le démarrage effectif sur place (plus bas dans ce
      // fichier) qui est réservé au jour prévu.
      // Une mission commencée doit être terminée avant d'en accepter une autre.
      // Une mission mise en "problème" (ex. client injoignable pour une
      // récupération) ne compte plus comme en cours : le livreur peut passer
      // à la suivante et y revenir plus tard dans la journée. Une mission
      // acceptée à l'avance pour une date future ne compte pas non plus —
      // elle n'est pas encore "en cours", juste réservée. Et dans l'autre
      // sens : accepter une mission dont la date prévue est future n'est lui-
      // même jamais bloqué par une mission en cours aujourd'hui, seule la
      // capacité du jour J compte réellement.
      const todayStr = new Date().toISOString().slice(0, 10);
      if (liv.date_prevue <= todayStr) {
        const { count } = await supabase
          .from('livraisons').select('id', { count: 'exact', head: true })
          .eq('transporteur_id', transporteurId)
          .in('statut', ['acceptee', 'arrivee'])
          .lte('date_prevue', todayStr)
          .neq('id', liv.id);
        if (count > 0) {
          return res.status(409).json({ error: 'Termine ta mission en cours avant d\'en accepter une nouvelle.' });
        }
      }
      await supabase.from('livraisons').update({ statut: 'acceptee', accepted_at: new Date().toISOString() }).eq('id', liv.id);

      // Le transporteur est autonome (les appels client passent directement
      // sur son propre téléphone, pas de bureau intermédiaire) — s'il reprend
      // une mission qui avait un incident lié (ex. client injoignable), Aly
      // n'a rien à faire, juste à être notifiée pour suivre l'avancement.
      if (liv.incident_id) {
        const { data: t } = await supabase.from('transporteurs').select('nom').eq('id', transporteurId).maybeSingle();
        await pushToAdmin(supabase, {
          title: '🔁 Mission injoignable reprise',
          body: `${t?.nom || 'Un transporteur'} reprend la mission ${liv.reservation?.adresse || ''} — le client était injoignable, il est de nouveau joignable.`,
          tag: 'client-disponible',
        });
      }

      // SMS client : prise en charge confirmée
      if (liv.reservation?.tel) {
        const dateStr = new Date(liv.date_prevue + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
        const verbe = liv.type === 'recuperation' ? 'récupérer votre climatiseur' : 'vous livrer votre climatiseur';
        await sendBrevoSms({
          to: liv.reservation.tel,
          content: `Loc'Air : votre mission du ${dateStr} est confirmée, notre technicien viendra ${verbe}. Il vous contactera 30 min avant. Questions : 06 63 79 87 56`,
        }).catch(() => {});
        // Best-effort : trace pour l'historique de la fiche client admin.
        if (liv.reservation_id) {
          supabase.from('email_log').insert({
            reservation_id: liv.reservation_id, scenario: 'sms_mission_confirmee', canal: 'sms',
            destinataire: liv.reservation.tel, modele: 'sms_mission_confirmee', statut: 'envoye',
          }).catch(() => {});
        }
      }

      return res.status(200).json({ ok: true, statut: 'acceptee' });
    }

    // Retour arrière si le livreur a accepté une mission par erreur (mauvais
    // tap) — remise en "à faire" pour lui-même (pas de réassignation à un
    // autre transporteur), sans effacer une éventuelle progression déjà
    // enregistrée (photo, vidange) qui resterait valable au retour dessus.
    // Autorisé aussi depuis "probleme" : le transporteur peut se débloquer
    // lui-même (ex. client absent, il repassera plus tard) sans attendre
    // qu'Aly résolve l'incident — la ligne "incidents" créée reste intacte,
    // seuls les champs de statut courant de la mission sont effacés.
    if (action === 'reporter') {
      if (!['acceptee', 'arrivee', 'probleme'].includes(liv.statut)) {
        return res.status(409).json({ error: 'Cette mission n\'est pas en cours' });
      }
      await supabase.from('livraisons').update({
        statut: 'a_faire', accepted_at: null, arrivee_at: null,
        probleme_type: null, probleme_description: null, probleme_at: null,
      }).eq('id', liv.id);
      return res.status(200).json({ ok: true, statut: 'a_faire' });
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

    if (action === 'confirmer_vidange') {
      if (liv.type !== 'recuperation' || !['acceptee', 'arrivee'].includes(liv.statut)) return res.status(409).json({ error: 'Étape non disponible' });
      const dateErr = missionStartDateError(liv);
      if (dateErr) return res.status(409).json({ error: dateErr });
      await supabase.from('livraisons').update({ vidange_confirmee: true, vidange_at: new Date().toISOString() }).eq('id', liv.id);
      return res.status(200).json({ ok: true });
    }

    // Étape Installation (livraison uniquement) : la photo de preuve (climatiseur
    // en marche + fenêtre calfeutrée + télécommande, tous visibles ensemble)
    // doit déjà être là avant de pouvoir confirmer avoir montré le
    // fonctionnement au client — même logique de garde-fou serveur que
    // confirmer_vidange.
    if (action === 'confirmer_demo') {
      if (liv.type !== 'livraison' || !['acceptee', 'arrivee'].includes(liv.statut)) return res.status(409).json({ error: 'Étape non disponible' });
      const dateErr = missionStartDateError(liv);
      if (dateErr) return res.status(409).json({ error: dateErr });
      if (!liv.photo_installation_path) {
        return res.status(400).json({ error: 'Photo requise avant de confirmer la démonstration' });
      }
      await supabase.from('livraisons').update({ demo_faite: true, demo_faite_at: new Date().toISOString() }).eq('id', liv.id);
      return res.status(200).json({ ok: true });
    }

    if (action === 'livraison_ok' || action === 'retour_ok') {
      const expectedType = action === 'livraison_ok' ? 'livraison' : 'recuperation';
      if (liv.type !== expectedType || !['acceptee', 'arrivee'].includes(liv.statut)) return res.status(409).json({ error: 'Étape non disponible' });
      const dateErr = missionStartDateError(liv);
      if (dateErr) return res.status(409).json({ error: dateErr });
      if (expectedType === 'livraison' && !liv.demo_faite) {
        return res.status(400).json({ error: 'Démonstration au client requise avant de valider' });
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
      await closeMissionIncident(supabase, liv);

      // Emails de scénario (moteur central _lib/emailEngine.js) — jamais
      // envoyés deux fois, historisés dans email_log. Ne doit jamais faire
      // échouer la validation de la mission si Brevo est indisponible.
      if (expectedType === 'livraison') {
        try {
          await sendScenarioEmail(supabase, { reservationId: liv.reservation_id, scenario: 'post_installation' });
        } catch (e) {
          console.error('[Email post_installation]', e.message);
        }
      }

      if (expectedType === 'recuperation') {
        await supabase.from('reservations').update({ statut: 'terminee' }).eq('id', liv.reservation_id);
        try {
          await sendScenarioEmail(supabase, { reservationId: liv.reservation_id, scenario: 'fin_location' });
        } catch (e) {
          console.error('[Email fin_location]', e.message);
        }
      }

      return res.status(200).json({ ok: true, statut: 'fait', montant_du_cents: montantDu });
    }

    // Mission "autre" (hors réservation, ex. récupérer du matériel livré et le
    // ramener au box) : pas de photo/vidange à valider, pas de barème — le
    // tarif a déjà été fixé par l'admin à la création, on ne le touche pas.
    if (action === 'autre_ok') {
      if (liv.type !== 'autre' || !['acceptee', 'arrivee'].includes(liv.statut)) return res.status(409).json({ error: 'Étape non disponible' });
      const dateErr = missionStartDateError(liv);
      if (dateErr) return res.status(409).json({ error: dateErr });

      await supabase.from('livraisons').update({
        statut: 'fait', fait_at: new Date().toISOString(),
      }).eq('id', liv.id);
      await closeMissionIncident(supabase, liv);

      return res.status(200).json({ ok: true, statut: 'fait', montant_du_cents: liv.montant_du_cents });
    }

    if (action === 'changement_ok') {
      if (liv.type !== 'changement' || !['acceptee', 'arrivee'].includes(liv.statut)) return res.status(409).json({ error: 'Étape non disponible' });
      const dateErr = missionStartDateError(liv);
      if (dateErr) return res.status(409).json({ error: dateErr });
      if (!liv.photo_installation_path) return res.status(400).json({ error: 'Vidéo du nouvel appareil installé requise avant de valider' });
      if (!liv.photo_retour_path) return res.status(400).json({ error: 'Vidéo de l\'ancien appareil récupéré requise avant de valider' });
      if (!liv.vidange_confirmee) return res.status(400).json({ error: 'Vidange de l\'ancien appareil requise avant de valider' });

      const tarifs = await getBaremeForCity(supabase, liv.reservation?.city_id);
      const montantDu = computeBareme('changement', null, tarifs);

      await supabase.from('livraisons').update({
        statut: 'fait', fait_at: new Date().toISOString(), montant_du_cents: montantDu,
      }).eq('id', liv.id);
      await closeMissionIncident(supabase, liv);

      return res.status(200).json({ ok: true, statut: 'fait', montant_du_cents: montantDu });
    }

    if (action === 'probleme') {
      const problemeType = ['client_absent', 'appareil_en_panne', 'retard', 'autre'].includes(body.probleme_type) ? body.probleme_type : 'autre';
      const description  = (body.probleme_description || '').slice(0, 1000);

      if (['acceptee', 'arrivee'].includes(liv.statut)) {
        const dateErr = missionStartDateError(liv);
        if (dateErr) return res.status(409).json({ error: dateErr });
      }

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
      // Une mission normale a toujours une réservation d'origine — sa city_id
      // est la source de vérité, jamais une ville devinée (voir
      // charge-retard.js). Une mission "autre" (hors réservation) porte sa
      // ville directement sur la ligne livraisons.
      let incidentCityId = liv.city_id || null;
      if (liv.reservation_id) {
        const { data: resaCity } = await supabase
          .from('reservations').select('city_id').eq('id', liv.reservation_id).maybeSingle();
        incidentCityId = resaCity?.city_id || null;
      }
      const { data: incident } = await supabase.from('incidents').insert({
        city_id:         incidentCityId,
        reservation_id: liv.reservation_id,
        type:            incidentType,
        description:     `[${liv.type}] ${description || problemeType}`,
        statut:          'ouvert',
      }).select('id').single();
      // Lien précis mission -> incident, pour le refermer automatiquement
      // dès que CETTE mission se termine normalement (voir closeMissionIncident).
      if (incident) {
        await supabase.from('livraisons').update({ incident_id: incident.id }).eq('id', liv.id);
      }

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
          // Best-effort : trace pour l'historique de la fiche client admin.
          supabase.from('email_log').insert({
            reservation_id: liv.reservation_id, scenario: 'sms_client_absent', canal: 'sms',
            destinataire: resa.tel, modele: 'sms_client_absent', statut: 'envoye',
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
