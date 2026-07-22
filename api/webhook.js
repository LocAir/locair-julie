const Stripe = require('stripe');
const { getSupabase } = require('./_lib/supabase');
const { confirmReservationAndCreateLivraisons } = require('./_lib/reservations');
const { sendBrevoEmail, sendBrevoSms } = require('./_lib/brevo');
const { pushToAdmin } = require('./_lib/push');
const { notifyTransporteur } = require('./_lib/transporteurNotif');
const { recordMouvement } = require('./_lib/stockMouvements');
const { generateAndSendDocuments, generateAndSendFactureVente } = require('./_lib/documents');
const { computeBareme, getBaremeForCity } = require('./_lib/bareme');
const { sendScenarioEmail, getSignature, withSignature } = require('./_lib/emailEngine');
const { escHtml, tplProlongConfirmation } = require('./_lib/emailTemplates');

// Offre Privilège (Step 2) : le client vient de payer pour garder son
// climatiseur actuel. Idempotent (un webhook Stripe peut être redélivré) —
// si l'offre est déjà "acceptee", ne refait rien. N'annule que la mission
// de récupération pas encore faite ; une récupération déjà "fait" (rare
// mais possible si le paiement arrive très tard) reste intacte.
async function handleOffrePrivilegeAccepted(supabase, offreId) {
  const { data: offre } = await supabase
    .from('offres_privilege').select('id, appareil_id, reservation_id, prix_vente_cents, statut')
    .eq('id', offreId).maybeSingle();
  if (!offre || offre.statut === 'acceptee') return;

  // L'admin a pu retirer l'offre (admin-offres-privilege.js action
  // "annuler") pile au moment où le client validait son paiement — fenêtre
  // de course rare mais réelle. Le client a alors été débité par Stripe
  // alors que l'offre n'est plus "proposee" : surtout ne pas vendre en
  // aveugle, on prévient l'admin pour qu'il rembourse manuellement.
  if (offre.statut !== 'proposee') {
    await pushToAdmin(supabase, {
      title: '⚠️ Paiement Offre Privilège reçu sur une offre retirée',
      body:  `Le client a payé ${(offre.prix_vente_cents / 100).toFixed(2)} € pour une offre annulée entre-temps. Aucune vente enregistrée — rembourse le client dans Stripe.`,
      tag:   `offre-privilege-conflit-${offre.id}`,
    });
    return;
  }

  await supabase.from('offres_privilege')
    .update({ statut: 'acceptee', decidee_at: new Date().toISOString() }).eq('id', offre.id);

  const { data: appareil } = await supabase.from('appareils').select('numero, localisation').eq('id', offre.appareil_id).maybeSingle();
  await recordMouvement(supabase, {
    appareilId: offre.appareil_id, typeEvenement: 'autre', nouveauStatut: 'vendu',
    nouvelleLocalisation: appareil?.localisation || 'autre', utilisateur: 'systeme',
    commentaire: `Vendu au client via l'Offre Privilège (${(offre.prix_vente_cents / 100).toFixed(2)} €).`,
  });

  try {
    await generateAndSendFactureVente(supabase, {
      reservationId: offre.reservation_id, appareilId: offre.appareil_id, prixCents: offre.prix_vente_cents,
    });
  } catch (e) {
    console.error('[Offre privilège — facture de vente]', e.message);
  }

  // Ce climatiseur sort de la réservation — il n'est plus à récupérer, qu'il
  // soit seul sur la réservation ou un parmi plusieurs (ex. 3 climatiseurs,
  // 1 seul acheté). setAppareilsStatutForReservation et l'appli transporteur
  // relisent toujours reservation_appareils à la volée : le retirer ici
  // suffit à réduire la mission de récupération aux seules unités restantes,
  // sans toucher aux colonnes de livraisons (qui ne connaissent pas les
  // appareils individuellement).
  await supabase.from('reservation_appareils')
    .delete().eq('reservation_id', offre.reservation_id).eq('appareil_id', offre.appareil_id);

  const { count: restants } = await supabase
    .from('reservation_appareils').select('id', { count: 'exact', head: true }).eq('reservation_id', offre.reservation_id);

  const { data: recup } = await supabase
    .from('livraisons').select('id, transporteur_id')
    .eq('reservation_id', offre.reservation_id).eq('type', 'recuperation')
    .in('statut', ['a_faire', 'acceptee', 'en_route', 'arrivee', 'probleme']).maybeSingle();

  if (!restants) {
    // Plus aucun climatiseur à récupérer sur cette réservation — la location
    // se termine entièrement par une vente. Sans ce passage à "terminee", le
    // tableau de bord client resterait bloqué sur "En location" pour
    // toujours (la mission de récupération, annulée juste en dessous, ne
    // validera plus jamais cette étape).
    await supabase.from('reservations').update({ statut: 'terminee' })
      .eq('id', offre.reservation_id).eq('statut', 'confirmee');
    if (recup) {
      await supabase.from('livraisons').update({ statut: 'annule' }).eq('id', recup.id);
      if (recup.transporteur_id) {
        await notifyTransporteur(supabase, recup.transporteur_id, {
          type: 'annulation', message: 'Le client a acheté son climatiseur — récupération annulée.', tag: 'annulation',
        });
      }
    }
  } else if (recup && recup.transporteur_id) {
    // Réservation à plusieurs climatiseurs : la mission reste active pour
    // les unités restantes, seul le nombre à récupérer diminue.
    await notifyTransporteur(supabase, recup.transporteur_id, {
      type: 'modification',
      message: `Le client a acheté le climatiseur #${appareil?.numero} — il reste ${restants} unité(s) à récupérer sur cette mission.`,
      tag: 'maj-mission-offre-privilege',
    });
  }

  await pushToAdmin(supabase, {
    title: '🎉 Offre Privilège acceptée',
    body:  restants
      ? `Climatiseur #${appareil?.numero} vendu — encore ${restants} unité(s) à récupérer sur cette réservation.`
      : `Climatiseur #${appareil?.numero} vendu — la récupération a été annulée automatiquement.`,
    tag:   `offre-privilege-acceptee-${offre.id}`,
  });
}

// ── Échec de paiement / remboursement / litige ────────────────────────────────
// Ces trois événements n'ont jamais été écoutés jusqu'ici : une carte refusée,
// un remboursement ou un litige Stripe restaient invisibles pour l'équipe
// (aucun incident créé, aucune notification). Ne touchent jamais aux emails
// de confirmation ni à la création des missions (chemin réservé à
// payment_intent.succeeded / checkout.session.completed, plus bas).
async function findReservationByPaymentIntent(supabase, paymentIntentId) {
  if (!paymentIntentId) return null;
  const { data } = await supabase
    .from('reservations').select('id, city_id, ref, statut, prenom, nom')
    .eq('stripe_payment_intent_id', paymentIntentId).maybeSingle();
  return data || null;
}

async function logPaymentIncident(supabase, { cityId, reservationId, description, montantCents = 0 }) {
  try {
    await supabase.from('incidents').insert({
      city_id: cityId || null,
      reservation_id: reservationId || null,
      type: 'autre',
      description,
      montant_facture_cents: montantCents,
      statut: 'nouveau',
    });
  } catch (e) {
    console.error('[Incident paiement]', e.message);
  }
}

async function handlePaymentFailed(supabase, intent) {
  const resa = await findReservationByPaymentIntent(supabase, intent.id);
  const raison = intent.last_payment_error?.message || 'raison inconnue';
  if (resa && resa.statut === 'en_attente') {
    await supabase.from('reservations').update({ statut: 'annulee' }).eq('id', resa.id);
  }
  await logPaymentIncident(supabase, {
    cityId: resa?.city_id,
    reservationId: resa?.id,
    description: `Paiement échoué${resa ? ' — dossier ' + resa.ref : ''} — ${raison}`,
  });
  await pushToAdmin(supabase, {
    title: 'Paiement échoué',
    body:  `${resa ? resa.ref + ' — ' : ''}${resa?.prenom || ''} ${resa?.nom || ''} — ${raison}`.trim(),
    tag:   'paiement-echoue',
  });
}

// Remboursement d'un achat Offre Privilège (déclenché par le bouton admin
// dédié — voir api/admin-offres-privilege.js action "rembourser"). Ce
// paiement n'a jamais de reservation_id sur reservations.stripe_payment_intent_id
// (l'offre stocke le sien à part), donc jamais trouvé par
// findReservationByPaymentIntent — c'est ce cas qui distingue un
// remboursement de location d'un remboursement d'Offre Privilège ci-dessous.
// Ne fait la bascule (offre "refusee") qu'une fois Stripe ayant réellement
// confirmé le remboursement — jamais de façon optimiste au moment du clic
// admin.
//
// Le climatiseur est physiquement encore chez le client au moment du
// remboursement (l'achat annulait sa récupération, voir
// handleOffrePrivilegeAccepted) — le repasser directement "disponible"
// ouvrirait la porte à une double réservation avant même qu'il ait été
// récupéré. On le passe donc "maintenance" (hors parc louable) et on crée
// une mission de récupération à dispatcher, plutôt que de suivre l'ancien
// comportement qui le rendait immédiatement réservable.
async function handleOffrePrivilegeRefunded(supabase, piId, montantCents) {
  const { data: offre } = await supabase
    .from('offres_privilege').select('id, appareil_id, reservation_id, statut')
    .eq('stripe_payment_intent_id', piId).maybeSingle();
  if (!offre || offre.statut !== 'acceptee') return false;

  await supabase.from('offres_privilege')
    .update({ statut: 'refusee', decidee_at: new Date().toISOString() }).eq('id', offre.id);

  const { data: appareil } = await supabase.from('appareils').select('numero, localisation, city_id').eq('id', offre.appareil_id).maybeSingle();
  await recordMouvement(supabase, {
    appareilId: offre.appareil_id, typeEvenement: 'autre', nouveauStatut: 'maintenance',
    nouvelleLocalisation: appareil?.localisation || 'chez_client', utilisateur: 'systeme',
    commentaire: 'Achat Offre Privilège remboursé — climatiseur encore chez le client, à récupérer avant de repasser disponible.',
  });

  let missionCreee = false;
  if (offre.reservation_id) {
    const { data: resa } = await supabase
      .from('reservations').select('prenom, nom, tel, adresse, city_id, hors_zone').eq('id', offre.reservation_id).maybeSingle();
    const cityId = appareil?.city_id || resa?.city_id;
    if (resa?.adresse && cityId) {
      const tarifs = await getBaremeForCity(supabase, cityId);
      const montantMission = computeBareme('recuperation', null, tarifs, resa.hors_zone);
      await supabase.from('livraisons').insert({
        type: 'autre', city_id: cityId,
        titre: `Récupérer climatiseur n°${appareil?.numero ?? ''} (Offre Privilège remboursée)`,
        adresse_libre: `${resa.adresse} — ${[resa.prenom, resa.nom].filter(Boolean).join(' ')}${resa.tel ? ' · ' + resa.tel : ''}`,
        date_prevue: new Date().toISOString().slice(0, 10),
        statut: 'a_faire', montant_du_cents: montantMission,
      });
      missionCreee = true;
    }
  }

  const montant = (montantCents / 100).toFixed(2) + ' €';
  await pushToAdmin(supabase, {
    title: '⚠️ Remboursement Offre Privilège — récupération à organiser',
    body:  `Climatiseur #${appareil?.numero} — ${montant} remboursés. Il est encore chez le client${missionCreee ? ' — mission de récupération créée dans Livraisons, à assigner à un transporteur.' : ' — aucune adresse retrouvée, organise sa récupération toi-même.'}`,
    tag:   `offre-privilege-remboursement-${offre.id}`,
  });
  return true;
}

async function handleChargeRefunded(supabase, charge) {
  const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : (charge.payment_intent?.id || '');
  const resa = await findReservationByPaymentIntent(supabase, piId);
  const montant = (charge.amount_refunded / 100).toFixed(2) + ' €';
  if (resa) {
    await supabase.from('reservations').update({ statut: 'remboursee' }).eq('id', resa.id);
  } else if (await handleOffrePrivilegeRefunded(supabase, piId, charge.amount_refunded || 0)) {
    return; // remboursement Offre Privilège déjà tracé + notifié ci-dessus
  }
  await logPaymentIncident(supabase, {
    cityId: resa?.city_id,
    reservationId: resa?.id,
    description: `Remboursement Stripe${resa ? ' — dossier ' + resa.ref : ''} — ${montant}`,
    montantCents: charge.amount_refunded || 0,
  });
  await pushToAdmin(supabase, {
    title: 'Remboursement Stripe',
    body:  `${resa ? resa.ref + ' — ' : ''}${resa?.prenom || ''} ${resa?.nom || ''} — ${montant}`.trim(),
    tag:   'remboursement',
  });
}

async function handleDisputeCreated(supabase, dispute) {
  const piId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : (dispute.payment_intent?.id || '');
  const resa = await findReservationByPaymentIntent(supabase, piId);
  const montant = (dispute.amount / 100).toFixed(2) + ' €';
  await logPaymentIncident(supabase, {
    cityId: resa?.city_id,
    reservationId: resa?.id,
    description: `Litige Stripe (chargeback)${resa ? ' — dossier ' + resa.ref : ''} — ${montant} — motif : ${dispute.reason || 'non précisé'}`,
    montantCents: dispute.amount || 0,
  });
  // Un litige a un délai de réponse imposé par Stripe (généralement quelques
  // jours) — l'admin doit le voir immédiatement, ce n'est jamais anodin.
  await pushToAdmin(supabase, {
    title: '⚠️ Litige Stripe (chargeback)',
    body:  `${resa ? resa.ref + ' — ' : ''}${resa?.prenom || ''} ${resa?.nom || ''} — ${montant} — à traiter dans le dashboard Stripe`.trim(),
    tag:   'litige-stripe',
  });
}

// ── Webhook principal ─────────────────────────────────────────────────────────
const handler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  // Lire le corps brut (nécessaire pour la vérification de signature Stripe)
  const rawBody = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // Vérification de signature Stripe (activer via STRIPE_WEBHOOK_SECRET dans Vercel)
  let body;
  if (process.env.STRIPE_WEBHOOK_SECRET) {
    const sig = req.headers['stripe-signature'];
    try {
      body = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('[Webhook signature]', err.message);
      return res.status(400).json({ error: 'Invalid signature' });
    }
  } else {
    return res.status(400).json({ error: 'STRIPE_WEBHOOK_SECRET non configuré' });
  }

  try {
    const eventType = body.type || '';
    const obj       = body?.data?.object || {};

    let meta            = null;
    let amount          = null;
    let email           = null;
    let customerId      = '';
    let paymentMethodId = '';

    if (eventType === 'payment_intent.succeeded') {
      const intent = await stripe.paymentIntents.retrieve(obj.id || '');
      if (intent.status !== 'succeeded') return res.json({ received: true, skipped: 'not succeeded' });
      meta            = intent.metadata || {};
      amount          = (intent.amount / 100).toFixed(2) + ' €';
      email           = intent.receipt_email || meta.email || '';
      customerId      = (typeof intent.customer === 'string' ? intent.customer : '') || meta.customer_id || '';
      paymentMethodId = (typeof intent.payment_method === 'string' ? intent.payment_method : '') || '';

    } else if (eventType === 'checkout.session.completed') {
      const session = await stripe.checkout.sessions.retrieve(obj.id || '');
      if (session.payment_status !== 'paid') return res.json({ received: true, skipped: 'not paid' });
      meta   = session.metadata || {};
      amount = (session.amount_total / 100).toFixed(2) + ' €';
      email  = session.customer_email || session.metadata?.email || '';

    } else if (eventType === 'payment_intent.payment_failed') {
      await handlePaymentFailed(getSupabase(), obj);
      return res.status(200).json({ received: true, type: 'payment_failed' });

    } else if (eventType === 'charge.refunded') {
      await handleChargeRefunded(getSupabase(), obj);
      return res.status(200).json({ received: true, type: 'refunded' });

    } else if (eventType === 'charge.dispute.created') {
      await handleDisputeCreated(getSupabase(), obj);
      return res.status(200).json({ received: true, type: 'dispute' });

    } else {
      return res.json({ received: true, skipped: eventType });
    }

    // ── Offre Privilège : flux totalement distinct, jamais une réservation ────
    // (voir api/offre-privilege-pay.js) — ne touche jamais reservations.
    if (meta.type === 'offre_privilege') {
      try {
        await handleOffrePrivilegeAccepted(getSupabase(), parseInt(meta.offre_id));
      } catch (e) {
        console.error('[Offre privilège webhook]', e.message);
      }
      return res.status(200).json({ received: true, type: 'offre_privilege' });
    }

    // ── Réservation en base : confirmation + création des missions terrain ────
    // Ne doit jamais bloquer les emails existants en cas de souci Supabase.
    let confirmedResa = null;
    try {
      confirmedResa = await confirmReservationAndCreateLivraisons(getSupabase(), obj.id || '');
    } catch (e) {
      console.error('[Reservation confirm]', e.message);
    }

    // ── Prolongation : flux distinct ─────────────────────────────────────────
    if (meta.type === 'prolongation') {
      await fetch('https://formspree.io/f/mvzyngoy', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          _subject:          `✅ PROLONGATION — ${meta.prenom || ''} ${meta.nom || ''} — ${meta.jours}j — récup. ${meta.date_recuperation || ''}`,
          type:              'prolongation',
          stripe_id:         obj.id || '',
          prenom:            meta.prenom            || '',
          nom:               meta.nom               || '',
          tel:               meta.tel               || '',
          email,
          adresse_origine:   meta.adresse_origine   || '',
          jours:             meta.jours             || '',
          date_recuperation: meta.date_recuperation || '',
          creneau:           meta.creneau           || '',
          montant:           amount,
          statut:            '✅ Stripe confirmé',
        }),
      }).catch(e => console.error('[Formspree prolong]', e.message));

      const sigProlong = await getSignature(getSupabase());
      const prolongLang = meta.lang || confirmedResa?.lang || 'fr';
      const prolongHtml = withSignature(tplProlongConfirmation({
        prenom:            meta.prenom            || '',
        nom:               meta.nom               || '',
        jours:             meta.jours             || '1',
        date_recuperation: meta.date_recuperation || '',
        creneau:           meta.creneau           || '',
        amount,
        lang:              prolongLang,
      }), sigProlong);
      const jNum = Number(meta.jours) || 1;
      const prolongSubject = prolongLang === 'en'
        ? `✅ Extension confirmed — ${jNum} day${jNum > 1 ? 's' : ''} added`
        : prolongLang === 'zh'
        ? `✅ 续租已确认 — 已延长 ${jNum} 天`
        : `✅ Prolongation confirmée — ${jNum} jour${jNum > 1 ? 's' : ''} ajoutés`;
      const resultProlong = await sendBrevoEmail({
        to:      email,
        subject: prolongSubject,
        html:    prolongHtml,
        senderName: sigProlong.nom_expediteur,
      });
      if (!resultProlong.ok) console.error('[Webhook] email prolong échoué —', resultProlong.error);
      // Best-effort : hors moteur de scénarios, juste une trace pour
      // l'historique de la fiche client.
      if (confirmedResa) {
        getSupabase().from('email_log').insert({
          reservation_id: confirmedResa.id, scenario: 'email_prolongation', canal: 'email',
          destinataire: email, modele: 'email_prolongation',
          statut: resultProlong.ok ? 'envoye' : 'erreur',
          erreur: resultProlong.ok ? null : String(resultProlong.error || '').slice(0, 500),
          contenu: prolongHtml,
        }).catch(() => {});
      }

      return res.status(200).json({ received: true, type: 'prolongation' });
    }

    // ── Contrat + facture PDF (réservation standard uniquement, jamais pour
    // une prolongation, jamais régénéré si déjà fait — voir _lib/documents.js) ─
    // Ne doit jamais bloquer les emails de confirmation existants ci-dessous.
    try {
      await generateAndSendDocuments(getSupabase(), confirmedResa);
    } catch (e) {
      console.error('[Documents]', e.message);
    }

    // ── Location standard ─────────────────────────────────────────────────────
    // 1. Notifier l'opérateur via Formspree
    await fetch('https://formspree.io/f/mvzyngoy', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        _subject:       `✅ PAIEMENT — ${meta.ref || obj.id} — ${meta.prenom || ''} ${meta.nom || ''}`,
        _replyto:       email,
        statut:           `✅ Stripe confirmé — ${amount}`,
        stripe_id:        obj.id || '',
        ref:              meta.ref          || '',
        prenom:           meta.prenom       || '',
        nom:              meta.nom          || '',
        tel:              meta.tel          || '',
        email:            email,
        adresse:          meta.adresse      || '',
        duree:            meta.duree        || '',
        date_livraison:   meta.date         || '',
        creneau:          meta.creneau      || '',
        installation:     meta.installation || '',
        fenetre:          meta.fenetre      || '',
        etage:            meta.etage        || '',
        ascenseur:        meta.ascenseur    || '',
        customer_id:      customerId,
        payment_method:   paymentMethodId,
      }),
    }).catch(e => console.error('[Formspree]', e.message));

    // 2a. SMS de confirmation immédiat au client
    if (meta.tel) {
      const lang = confirmedResa?.lang || meta.lang || 'fr';
      const d = meta.date ? new Date(meta.date + 'T12:00:00Z') : null;
      let smsConfirmationContent;
      if (lang === 'en') {
        const dateStr = d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : '';
        smsConfirmationContent = `Loc'Air: booking confirmed ✅${dateStr ? ' Delivery on ' + dateStr : ''}${meta.creneau ? ' · ' + meta.creneau : ''}. Your technician will call you 30 min before arriving. Questions: +33 6 63 79 87 56`;
      } else if (lang === 'zh') {
        const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
        const dateStr = d ? `${months[d.getUTCMonth()]}${d.getUTCDate()}日` : '';
        smsConfirmationContent = `Loc'Air：预订已确认 ✅${dateStr ? ' 配送日期：' + dateStr : ''}${meta.creneau ? ' · ' + meta.creneau : ''}。技术员将在到达前30分钟致电。咨询：+33 6 63 79 87 56`;
      } else {
        const dateStr = d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '';
        smsConfirmationContent = `Loc'Air : réservation confirmée ✅${dateStr ? ' Livraison le ' + dateStr : ''}${meta.creneau ? ' · ' + meta.creneau : ''}. Votre technicien vous appellera 30 min avant d'arriver. Questions : 06 63 79 87 56`;
      }
      await sendBrevoSms({ to: meta.tel, content: smsConfirmationContent }).catch(() => {});
      // Best-effort : hors moteur de scénarios (SMS ponctuel, jamais figé à
      // l'avance), juste une trace pour l'historique de la fiche client —
      // ne doit jamais faire échouer le webhook Stripe.
      if (confirmedResa) {
        getSupabase().from('email_log').insert({
          reservation_id: confirmedResa.id, scenario: 'sms_confirmation', canal: 'sms',
          destinataire: meta.tel, modele: 'sms_confirmation', statut: 'envoye', contenu: smsConfirmationContent,
        }).catch(() => {});
      }
    }

    // 2b. Email de confirmation — via le moteur central (scénario
    // 'confirmation', historisé dans email_log, jamais envoyé deux fois même
    // en cas de redélivrance du webhook Stripe). Les rappels J-14/J-3/J-1/
    // avant-fin-location/récupération sont désormais évalués chaque jour par
    // cron-daily.js à partir des données Supabase du moment (jamais figés à
    // l'avance comme l'ancien envoi programmé via scheduledAt) — voir
    // _lib/emailSchedule.js et _lib/emailEngine.js.
    if (confirmedResa) {
      try {
        await sendScenarioEmail(getSupabase(), { reservationId: confirmedResa.id, scenario: 'confirmation' });
      } catch (e) {
        console.error('[Email confirmation]', e.message);
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Stripe webhook]', err.message);
    return res.status(200).json({ received: true, error: 'internal' });
  }
};

// Désactiver le body parser Vercel pour accéder au corps brut (signature Stripe)
handler.config = { api: { bodyParser: false } };
module.exports = handler;
