const { notifyTransporteur } = require('./transporteurNotif');
const { extractPostalCode } = require('./postal');
const { notifyIfSoldOut } = require('./city');
const { recordMouvement } = require('./stockMouvements');
const { addDays } = require('./dates');
const { generateAndSendDocuments } = require('./documents');
const { sendBrevoEmail, sendBrevoSms } = require('./brevo');
const { sendScenarioEmail, getSignature, withSignature } = require('./emailEngine');
const { tplProlongConfirmation } = require('./emailTemplates');

function normalizeTel(tel) {
  return String(tel || '').replace(/\D/g, '');
}

// Doit rester synchronisé avec TEST_TRANSPORTEUR_NOM dans admin/index.html —
// ce compte factice (créé pour qu'Aly puisse tester /transporteur lui-même)
// ne doit jamais recevoir de vraie mission cliente par la répartition auto.
const TEST_TRANSPORTEUR_NOM = '🧪 Test (aperçu admin)';

// Dérive le moment (matin/après-midi) d'un créneau texte libre choisi par le
// client (ex. "8h-12h") — heure de début < 12 -> matin, sinon après-midi.
// Une mission sans créneau précis (récupération, coordonnée par l'équipe) a
// moment=null : la disponibilité ne compare alors que le jour.
function momentForCreneau(creneau) {
  const m = String(creneau || '').match(/^(\d{1,2})h/);
  if (!m) return null;
  return parseInt(m[1], 10) < 12 ? 'matin' : 'apres_midi';
}

// Transporteurs éligibles pour une mission donnée : actifs, pas en pause, pas
// le compte de test, couvrant la zone (transporteur_villes), et disponibles
// ce jour/moment (transporteur_disponibilites — aucune ligne = disponible
// tout le temps, compatibilité avec une équipe sans restriction configurée).
// missionType : valeur parmi 'livraison', 'livraison_technicien', 'recuperation',
// 'changement'. Un tableau types_autorises vide = sans restriction (default).
async function eligibleTransporteurs(supabase, cityId, dateISO, moment, missionType) {
  const { data: villes } = await supabase
    .from('transporteur_villes').select('transporteur_id').eq('city_id', cityId);
  const villeIds = [...new Set((villes || []).map(v => v.transporteur_id))];
  if (!villeIds.length) return [];

  const { data: transporteurs } = await supabase
    .from('transporteurs').select('id, types_autorises')
    .in('id', villeIds).eq('actif', true).eq('en_pause', false).neq('nom', TEST_TRANSPORTEUR_NOM)
    .order('id', { ascending: true });
  if (!transporteurs || !transporteurs.length) return [];

  // Filtrer par type de mission si précisé — tableau vide = tous types autorisés
  const filtered = missionType
    ? transporteurs.filter(t => !t.types_autorises?.length || t.types_autorises.includes(missionType))
    : transporteurs;
  const ids = filtered.map(t => t.id);
  if (!ids.length) return [];

  const jour = new Date(dateISO + 'T00:00:00').getDay();
  const { data: dispos } = await supabase
    .from('transporteur_disponibilites').select('transporteur_id, jour, moment')
    .in('transporteur_id', ids);

  const restricted = new Set((dispos || []).map(d => d.transporteur_id));
  return ids.filter(id => {
    if (!restricted.has(id)) return true; // aucune ligne = toujours disponible
    return (dispos || []).some(d =>
      d.transporteur_id === id && d.jour === jour &&
      (d.moment === 'journee' || !moment || d.moment === moment)
    );
  });
}

// Rotation dérivée de l'historique réel (jamais de compteur stocké à part) —
// le tour se déduit à chaque appel du dernier transporteur (parmi le pool
// éligible donné) ayant reçu une mission, donc aucune désynchronisation
// possible si quelqu'un est ajouté/retiré/devient indisponible entre deux
// confirmations : il rejoint simplement le tour à sa position triée.
async function roundRobinPickFromPool(supabase, pool) {
  if (!pool.length) return null;
  const sorted = [...pool].sort((a, b) => a - b);
  const { data: last } = await supabase
    .from('livraisons').select('transporteur_id')
    .in('transporteur_id', sorted)
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle();
  let idx = 0;
  if (last && last.transporteur_id) {
    const lastIdx = sorted.indexOf(last.transporteur_id);
    if (lastIdx !== -1) idx = (lastIdx + 1) % sorted.length;
  }
  return sorted[idx];
}

// Choisit le transporteur pour UNE mission (une ligne livraison/récupération) :
//  1. Zone + disponibilité (filtre strict, voir eligibleTransporteurs) — si
//     personne n'est éligible, renvoie null (mission non assignée, captée
//     par le badge "non assignées" de l'admin).
//  2. Regroupement géographique : si quelqu'un du pool a déjà une mission ce
//     jour-là dans le même code postal, elle lui revient en priorité — sauf
//     si un autre éligible n'a encore aucune mission ce jour-là, l'équité
//     prime alors sur le regroupement.
//  3. Rotation équitable classique sinon.
// `usedInBatch` évite que les deux jambes d'une même confirmation tombent
// sur la même personne quand une alternative existe dans le pool (la 1re
// ligne n'est pas encore en base au moment de choisir la 2e, donc invisible
// à la rotation dérivée de l'historique).
async function pickTransporteurForMission(supabase, { cityId, dateISO, creneau, adresse, usedInBatch, type, installation }) {
  const moment = momentForCreneau(creneau);
  // 'livraison_technicien' si le client a choisi l'option technicien (tarif 40€)
  const missionType = type === 'livraison' && (installation || '').startsWith('Technicien')
    ? 'livraison_technicien'
    : (type || null);
  const pool = await eligibleTransporteurs(supabase, cityId, dateISO, moment, missionType);
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0];

  const { data: todaysLivraisons } = await supabase
    .from('livraisons')
    .select('transporteur_id, reservation:reservations(adresse)')
    .eq('date_prevue', dateISO)
    .in('transporteur_id', pool)
    .not('statut', 'in', '(annule,refusee)');

  const assignedToday = new Set((todaysLivraisons || []).map(l => l.transporteur_id));
  const hasSomeoneAtZero = pool.some(id => !assignedToday.has(id));

  let chosen = null;
  const cp = extractPostalCode(adresse);
  if (cp && !hasSomeoneAtZero) {
    const match = (todaysLivraisons || []).find(l => extractPostalCode(l.reservation?.adresse) === cp);
    if (match) chosen = match.transporteur_id;
  }
  if (!chosen) chosen = await roundRobinPickFromPool(supabase, pool);

  if (usedInBatch && usedInBatch.has(chosen) && pool.length > 1) {
    const alt = pool.find(id => !usedInBatch.has(id));
    if (alt != null) chosen = alt;
  }
  return chosen;
}

// Retrouve ou crée la fiche client (déduplication par téléphone, dans la même
// ville) — sans quoi chaque réservation reste une île isolée et une info comme
// "digicode faux à cette adresse" ne profite jamais aux visites suivantes.
async function findOrCreateClient(supabase, resa) {
  const telNorm = normalizeTel(resa.tel);
  if (!telNorm) return null;

  const { data: existing } = await supabase
    .from('clients').select('id').eq('city_id', resa.city_id).eq('tel_normalise', telNorm).maybeSingle();
  if (existing) return existing.id;

  const { data: created } = await supabase.from('clients').insert({
    city_id: resa.city_id, prenom: resa.prenom, nom: resa.nom,
    tel: resa.tel, tel_normalise: telNorm, email: resa.email,
  }).select('id').single();
  return created?.id || null;
}

// Assigne un ou plusieurs appareils numérotés à une réservation confirmée.
// Idempotent par construction : si des appareils sont déjà liés à cette
// réservation (webhook Stripe redélivré), ne fait rien.
async function assignAppareils(supabase, resa, staleOriginalId) {
  const { data: already, error: alreadyErr } = await supabase
    .from('reservation_appareils').select('id').eq('reservation_id', resa.id).limit(1);
  if (alreadyErr) throw alreadyErr;
  if (already.length) return;

  // Prolongation : le client garde physiquement le même climatiseur, ce n'est
  // pas un nouvel appareil — on reprend celui (ou ceux) de la réservation
  // d'origine plutôt que d'en assigner un autre au hasard.
  let manque = resa.quantite;
  if (staleOriginalId) {
    const { data: origAppareils } = await supabase
      .from('reservation_appareils').select('appareil_id')
      .eq('reservation_id', staleOriginalId).limit(resa.quantite);
    const ids = (origAppareils || []).map(r => r.appareil_id);
    if (ids.length) {
      await supabase.from('reservation_appareils')
        .insert(ids.map(appareil_id => ({ reservation_id: resa.id, appareil_id })));
      manque -= ids.length;
    }
  }

  if (manque > 0) {
    const { data: assigned } = await supabase.rpc('assign_appareils', {
      p_reservation_id: resa.id,
      p_city_id:        resa.city_id,
      p_quantite:       manque,
      p_date_debut:     resa.date_debut,
      p_date_fin:       resa.date_fin,
    });
    // Mouvement de stock (Module 6, Partie 5) : attribution à une réservation.
    // Ne touche pas au statut (déjà géré par assign_appareils/le parcours
    // transporteur) — seule la localisation reste "stock_principal" à ce
    // stade (l'appareil n'a pas encore quitté le dépôt).
    for (const a of (assigned || [])) {
      await recordMouvement(supabase, {
        appareilId: a.id, typeEvenement: 'attribution_reservation',
        nouvelleLocalisation: 'stock_principal', reservationId: resa.id, utilisateur: 'systeme',
      });
    }
  }
}

// Envoie les 3 communications de confirmation d'une réservation standard
// (contrat+facture PDF, SMS immédiat, email "confirmation") — jusqu'ici
// déclenchées uniquement par le webhook Stripe (paiement en ligne), jamais
// pour une réservation saisie à la main par l'admin (téléphone/WhatsApp),
// qui restait ainsi sans aucune communication client. Chaque appelant
// (webhook.js, admin-reservations.js) doit appeler cette fonction juste
// après confirmReservation() — jamais pour une prolongation, voir
// sendProlongationConfirmation ci-dessous. Best-effort : une erreur sur un
// canal ne doit jamais empêcher les autres (chaque étape a son propre
// try/catch, comme dans webhook.js).
async function sendConfirmationCommunications(supabase, resa) {
  if (!resa || !resa.id) return;

  try {
    await generateAndSendDocuments(supabase, resa);
  } catch (e) {
    console.error('[Documents]', e.message);
  }

  if (resa.tel) {
    const { data: smsDejaEnvoye } = await supabase
      .from('email_log').select('id')
      .eq('reservation_id', resa.id).eq('scenario', 'sms_confirmation').eq('statut', 'envoye')
      .maybeSingle();
    if (!smsDejaEnvoye) {
    const lang = resa.lang || 'fr';
    const d = resa.date_debut ? new Date(String(resa.date_debut).slice(0, 10) + 'T12:00:00Z') : null;
    let smsConfirmationContent;
    if (lang === 'en') {
      const dateStr = d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : '';
      smsConfirmationContent = `Loc'Air: booking confirmed ✅${dateStr ? ' Delivery on ' + dateStr : ''}${resa.creneau ? ' · ' + resa.creneau : ''}. Your technician will call you 30 min before arriving. Questions: +33 6 63 79 87 56`;
    } else if (lang === 'zh') {
      const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
      const dateStr = d ? `${months[d.getUTCMonth()]}${d.getUTCDate()}日` : '';
      smsConfirmationContent = `Loc'Air：预订已确认 ✅${dateStr ? ' 配送日期：' + dateStr : ''}${resa.creneau ? ' · ' + resa.creneau : ''}。技术员将在到达前30分钟致电。咨询：+33 6 63 79 87 56`;
    } else {
      const dateStr = d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '';
      smsConfirmationContent = `Loc'Air : réservation confirmée ✅${dateStr ? ' Livraison le ' + dateStr : ''}${resa.creneau ? ' · ' + resa.creneau : ''}. Votre technicien vous appellera 30 min avant d'arriver. Questions : 06 63 79 87 56`;
    }
    await sendBrevoSms({ to: resa.tel, content: smsConfirmationContent }).catch(() => {});
    await supabase.from('email_log').insert({
      reservation_id: resa.id, scenario: 'sms_confirmation', canal: 'sms',
      destinataire: resa.tel, modele: 'sms_confirmation', statut: 'envoye', contenu: smsConfirmationContent,
    }).catch(() => {});
    } // end if (!smsDejaEnvoye)
  }

  try {
    await sendScenarioEmail(supabase, { reservationId: resa.id, scenario: 'confirmation' });
  } catch (e) {
    console.error('[Email confirmation]', e.message);
  }
}

// Équivalent de sendConfirmationCommunications, mais pour une prolongation
// (pas de contrat/facture, pas de SMS — un seul email dédié, historiquement
// envoyé par webhook.js pour une prolongation payée en ligne via
// /prolongation). `reservationId` peut être null (best-effort, ex. si
// confirmReservation a échoué) — l'email part quand même, seule la trace
// email_log/l'idempotence sont alors sautées.
// `amount` et `dateRecuperation` sont déjà formatés par l'appelant (chacun
// a sa propre source : montant Stripe pour un paiement en ligne, prix saisi
// par l'admin pour une prolongation manuelle) — cette fonction ne fait que
// construire l'email et l'envoyer, pas de recalcul qui pourrait diverger.
async function sendProlongationConfirmation(supabase, { reservationId, email, prenom, nom, jours, dateRecuperation, creneau, amount, lang }) {
  if (!email) return;
  lang = lang || 'fr';

  // Idempotence : un webhook Stripe peut être redélivré pour le même
  // paiement — ne jamais renvoyer cet email deux fois pour la même réservation.
  if (reservationId) {
    const { count: alreadySent } = await supabase
      .from('email_log').select('id', { count: 'exact', head: true })
      .eq('reservation_id', reservationId).eq('scenario', 'email_prolongation').eq('statut', 'envoye');
    if (alreadySent > 0) return;
  }

  const sig = await getSignature(supabase);
  const html = withSignature(tplProlongConfirmation({
    prenom: prenom || '', nom: nom || '', jours: jours || 1,
    date_recuperation: dateRecuperation || '', creneau: creneau || '', amount, lang,
  }), sig);
  const jNum = Number(jours) || 1;
  const subject = lang === 'en' ? `✅ Extension confirmed — ${jNum} day${jNum > 1 ? 's' : ''} added`
    : lang === 'zh' ? `✅ 续租已确认 — 已延长 ${jNum} 天`
    : `✅ Prolongation confirmée — ${jNum} jour${jNum > 1 ? 's' : ''} ajoutés`;
  const result = await sendBrevoEmail({ to: email, subject, html, senderName: sig.nom_expediteur });
  if (!result.ok) console.error('[Prolongation confirmation]', result.error);
  if (reservationId) {
    await supabase.from('email_log').insert({
      reservation_id: reservationId, scenario: 'email_prolongation', canal: 'email',
      destinataire: email, modele: 'email_prolongation',
      statut: result.ok ? 'envoye' : 'erreur',
      erreur: result.ok ? null : String(result.error || '').slice(0, 500),
      contenu: html,
    }).catch(() => {});
  }
}

// Confirme une réservation (paiement Stripe réussi OU confirmation manuelle par
// l'admin, ex. réservation prise par téléphone), assigne les appareils
// numérotés et crée les missions terrain (livraisons) associées. Idempotent :
// sans effet si déjà confirmée, pour tolérer les livraisons en double des
// webhooks Stripe redélivrés.
async function confirmReservation(supabase, resa) {
  if (['confirmee', 'annulee', 'remboursee'].includes(resa.statut)) return resa;

  const clientId = await findOrCreateClient(supabase, resa);
  resa.client_id = clientId;
  await supabase.from('reservations').update({ statut: 'confirmee', client_id: clientId }).eq('id', resa.id);

  // Prolongation : retrouver la réservation d'origine (même client, même ville,
  // récupération initiale = début de l'extension) — sert à la fois à lui
  // transférer les mêmes appareils et à annuler sa récupération devenue obsolète.
  let staleOriginalId = null;
  if (resa.source === 'site_prolongation' && resa.email) {
    const { data: stale } = await supabase
      .from('reservations')
      .select('id')
      .eq('city_id', resa.city_id)
      // ilike plutôt que eq : des réservations plus anciennes ont pu stocker
      // l'email avec une casse différente (avant que checkout.js/
      // prolong-pay.js ne le mettent systématiquement en minuscules) — une
      // comparaison stricte les aurait ratées et laissé leur mission de
      // récupération obsolète active au calendrier.
      .ilike('email', resa.email)
      .eq('date_fin', resa.date_debut)
      .neq('id', resa.id);
    if (stale && stale.length) {
      staleOriginalId = stale[0].id;
      // Récupère les transporteurs déjà assignés avant d'annuler, pour pouvoir
      // les prévenir (même téléphone fermé) qu'une mission qu'on leur avait
      // confiée n'a plus lieu d'être.
      const { data: toCancel } = await supabase
        .from('livraisons').select('id, transporteur_id')
        .in('reservation_id', stale.map(r => r.id))
        .eq('type', 'recuperation')
        .eq('statut', 'a_faire');
      if (toCancel && toCancel.length) {
        await supabase.from('livraisons').update({ statut: 'annule' }).in('id', toCancel.map(l => l.id));
        const transpIds = [...new Set(toCancel.map(l => l.transporteur_id).filter(Boolean))];
        for (const tid of transpIds) {
          await notifyTransporteur(supabase, tid, {
            type: 'annulation', message: 'Une récupération a été annulée — le client a prolongé sa location.',
            tag: 'mission-annulee',
          });
        }
      }
    }
  }

  await assignAppareils(supabase, resa, staleOriginalId);

  const { data: existing, error: existingErr } = await supabase.from('livraisons').select('id').eq('reservation_id', resa.id);
  if (existingErr) throw existingErr;
  if (existing.length === 0) {
    // Le créneau choisi par le client sur le site (reservations.creneau) doit
    // atteindre la mission opérationnelle — jusqu'ici il finissait seulement
    // dans l'email de confirmation, jamais dans le planning admin/livreur.
    // Pour une réservation normale, resa.creneau = créneau de LIVRAISON choisi
    // par le client (la récupération reste "coordonnée par l'équipe", jamais
    // choisie côté site — pas de créneau à pré-remplir). Pour une prolongation,
    // resa.creneau = créneau de RÉCUPÉRATION choisi par le client.
    //
    // La récupération est toujours programmée le lendemain (J+1) de la fin de
    // location, jamais le jour même : le client profite de son climatiseur
    // jusqu'au bout de sa réservation.
    const dateRecuperation = addDays(resa.date_fin, 1);
    const rows = resa.source === 'site_prolongation'
      ? [{ reservation_id: resa.id, type: 'recuperation', date_prevue: dateRecuperation, creneau: resa.creneau || null }]
      : [
          { reservation_id: resa.id, type: 'livraison',    date_prevue: resa.date_debut, creneau: resa.creneau || null },
          { reservation_id: resa.id, type: 'recuperation', date_prevue: dateRecuperation },
        ];

    // Répartition auto uniquement pour ce qui vient vraiment du site (paiement
    // ou prolongation) — une réservation saisie à la main par l'admin
    // (téléphone/WhatsApp, source "manuel") reste à assigner soi-même : à ce
    // moment-là, l'admin a souvent déjà négocié avec un transporteur précis.
    if (resa.source !== 'manuel') {
      const usedInBatch = new Set();
      for (const row of rows) {
        const tid = await pickTransporteurForMission(supabase, {
          cityId: resa.city_id, dateISO: row.date_prevue, creneau: row.creneau, adresse: resa.adresse, usedInBatch,
          type: row.type, installation: resa.installation,
        });
        if (tid) { row.transporteur_id = tid; usedInBatch.add(tid); }
      }
    }

    const { data: insertedLivraisons, error: livError } = await supabase
      .from('livraisons').insert(rows).select('id, type, transporteur_id');
    if (livError) throw livError;

    // Prévient chaque transporteur auto-assigné, exactement comme pour une
    // assignation manuelle — sans quoi une mission peut attendre des heures
    // qu'il pense à rouvrir l'app de lui-même.
    const notified = new Set();
    for (const liv of (insertedLivraisons || [])) {
      if (liv.transporteur_id && !notified.has(liv.transporteur_id)) {
        notified.add(liv.transporteur_id);
        await notifyTransporteur(supabase, liv.transporteur_id, {
          type: 'nouvelle_mission', message: 'Une mission vous a été attribuée automatiquement.',
          livraisonId: liv.id, tag: 'nouvelle-mission',
        });
      }
    }

    // Mouvement de stock (Module 6, Partie 7) : dès qu'une mission de
    // livraison existe, l'appareil attribué à cette réservation passe "en
    // préparation" (événement seul — le statut lui-même ne change qu'à
    // l'installation réelle, voir _lib/appareilSync.js).
    const livraisonMission = (insertedLivraisons || []).find(l => l.type === 'livraison');
    if (livraisonMission) {
      const { data: ras } = await supabase.from('reservation_appareils').select('appareil_id').eq('reservation_id', resa.id);
      for (const ra of (ras || [])) {
        await recordMouvement(supabase, {
          appareilId: ra.appareil_id, typeEvenement: 'preparation_livraison',
          nouvelleLocalisation: 'stock_principal', livraisonId: livraisonMission.id,
          reservationId: resa.id, utilisateur: 'systeme',
        });
      }
    }
  }

  // Cette confirmation vient d'assigner des appareils — c'est le moment le
  // plus probable pour que le stock de la ville tombe à zéro. Alerte Aly
  // si c'est le cas (ne fait jamais échouer la confirmation elle-même).
  await notifyIfSoldOut(supabase, resa.city_id);

  return resa;
}

// Point d'entrée du webhook Stripe : retrouve la réservation par son
// PaymentIntent puis délègue à confirmReservation.
async function confirmReservationAndCreateLivraisons(supabase, paymentIntentId) {
  const { data: resa, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();
  if (error || !resa) return null;
  return confirmReservation(supabase, resa);
}

module.exports = {
  confirmReservationAndCreateLivraisons, confirmReservation, pickTransporteurForMission, normalizeTel,
  sendConfirmationCommunications, sendProlongationConfirmation,
};
