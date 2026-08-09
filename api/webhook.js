const Stripe = require('stripe');
const { getSupabase } = require('./_lib/supabase');
const { confirmReservationAndCreateLivraisons, sendProlongationConfirmation } = require('./_lib/reservations');
const { sendBrevoEmail, sendBrevoSms } = require('./_lib/brevo');
const { pushToAdmin } = require('./_lib/push');
const { notifyTransporteur } = require('./_lib/transporteurNotif');
const { recordMouvement } = require('./_lib/stockMouvements');
const { releaseAppareilFromReservation } = require('./_lib/appareilSync');
const { generateAndSendDocuments, generateAndSendDocumentsAfterProlongation, generateAndSendFactureVente } = require('./_lib/documents');
const { computeBareme, getBaremeForCity } = require('./_lib/bareme');
const { todayParis } = require('./_lib/dates');
const { sendScenarioEmail } = require('./_lib/emailEngine');

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

  // offre-privilege-pay.js verrouille l'offre en 'en_cours' dès que le
  // client lance le paiement (empêche un double-clic de créer deux
  // PaymentIntents) — c'est donc l'état normal ici, pas seulement
  // 'proposee'. L'admin a pu malgré tout retirer l'offre entre-temps
  // (admin-offres-privilege.js action "annuler", qui refuse justement
  // de toucher une offre 'en_cours' — donc en pratique seulement possible
  // si elle était encore 'proposee' au moment de l'annulation) : le client
  // a alors été débité par Stripe sur une offre qui n'est plus valable —
  // surtout ne pas vendre en aveugle, on prévient l'admin pour qu'il
  // rembourse manuellement.
  if (!['proposee', 'en_cours'].includes(offre.statut)) {
    await pushToAdmin(supabase, {
      title: '⚠️ Paiement Offre Privilège reçu sur une offre retirée',
      body:  `Le client a payé ${(offre.prix_vente_cents / 100).toFixed(2)} € pour une offre annulée entre-temps. Aucune vente enregistrée — rembourse le client dans Stripe.`,
      tag:   `offre-privilege-conflit-${offre.id}`,
    });
    return;
  }

  const { data: claimed } = await supabase.from('offres_privilege')
    .update({ statut: 'acceptee', decidee_at: new Date().toISOString() })
    .eq('id', offre.id).in('statut', ['proposee', 'en_cours']).select('id');
  if (!claimed?.length) return;

  const { data: appareil } = await supabase.from('appareils').select('numero, localisation').eq('id', offre.appareil_id).maybeSingle();
  try {
    await recordMouvement(supabase, {
      appareilId: offre.appareil_id, typeEvenement: 'autre', nouveauStatut: 'vendu',
      nouvelleLocalisation: appareil?.localisation || 'autre', utilisateur: 'systeme',
      commentaire: `Vendu au client via l'Offre Privilège (${(offre.prix_vente_cents / 100).toFixed(2)} €).`,
    });
  } catch (e) {
    console.error('[Offre privilège — recordMouvement]', e.message);
    await pushToAdmin(supabase, {
      title: '⚠️ Offre Privilège — appareil non marqué "vendu"',
      body: `Offre ${offre.id} : le paiement est confirmé mais le statut de l'appareil #${appareil?.numero} n'a pas pu être mis à jour. Corrige-le manuellement dans le stock.`,
      tag: `offre-privilege-mouvement-err-${offre.id}`,
    }).catch(() => {});
  }

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

  if (restants === 0) {
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
    .from('reservations').select('id, city_id, ref, statut, prenom, nom, partenaire_commission_payee')
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
    await supabase.from('reservations').update({ statut: 'annulee' }).eq('id', resa.id).eq('statut', 'en_attente');
  }
  await logPaymentIncident(supabase, {
    cityId: resa?.city_id,
    reservationId: resa?.id,
    description: `Paiement échoué${resa ? ' — dossier ' + resa.ref : ''} — ${raison}`,
  });
  await pushToAdmin(supabase, {
    title: 'Paiement échoué',
    body:  `${resa ? resa.ref + ' — ' : ''}${resa?.prenom || ''} ${resa?.nom || ''} — ${raison}`.trim(),
    // Tag unique par tentative de paiement — un tag fixe faisait disparaître
    // silencieusement l'alerte d'un client dès qu'un autre paiement échouait
    // le même jour (audit automatisations, 2026-08-02).
    tag:   `paiement-echoue-${resa?.id || intent.id}`,
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
        date_prevue: todayParis(),
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
  // Un remboursement partiel (ex. geste commercial de quelques euros) ne doit
  // jamais déclencher les effets d'une annulation complète — sans cette
  // vérification, un petit remboursement sur un achat Offre Privilège
  // repassait à tort le climatiseur "maintenance" et envoyait un transporteur
  // le récupérer chez un client qui a pourtant le droit de le garder.
  const remboursementTotal = charge.amount > 0 && charge.amount_refunded >= charge.amount;
  // Un remboursement total ne déclenchait jusqu'ici que le changement de
  // statut — contrairement à une annulation admin (admin-reservations.js),
  // rien n'annulait la mission du transporteur ni ne libérait le climatiseur
  // au stock. Un transporteur pouvait donc encore livrer/récupérer pour une
  // réservation déjà remboursée, et l'appareil restait marqué "loué" pour
  // rien (audit automatisations, 2026-08-02).
  let livraisonDejaEffectuee = false;
  if (resa) {
    // Marquer remboursée seulement si le remboursement couvre la totalité du paiement
    if (remboursementTotal) {
      await supabase.from('reservations').update({ statut: 'remboursee' }).eq('id', resa.id).eq('statut', 'confirmee');

      const { data: missions } = await supabase
        .from('livraisons').select('id, type, statut, transporteur_id')
        .eq('reservation_id', resa.id)
        .not('statut', 'in', '(annule,annulee)');
      livraisonDejaEffectuee = (missions || []).some(m => m.type === 'livraison' && m.statut === 'fait');

      if (!livraisonDejaEffectuee) {
        // Le climatiseur n'a jamais quitté le stock : mêmes effets qu'une
        // annulation classique (voir admin-reservations.js, patch.statut===
        // 'annulee') — annuler les missions encore actives, prévenir le
        // transporteur déjà assigné, libérer l'appareil.
        const aAnnuler = (missions || []).filter(m => m.statut !== 'fait');
        if (aAnnuler.length) {
          await supabase.from('livraisons').update({ statut: 'annule' }).in('id', aAnnuler.map(m => m.id));
          const transpIds = [...new Set(aAnnuler.map(m => m.transporteur_id).filter(Boolean))];
          for (const tid of transpIds) {
            await notifyTransporteur(supabase, tid, {
              type: 'annulation', message: 'Une mission a été annulée — la réservation a été remboursée.', tag: 'annulation',
            });
          }
        }
        try {
          const { data: liens } = await supabase.from('reservation_appareils').select('appareil_id').eq('reservation_id', resa.id);
          for (const l of (liens || [])) {
            await releaseAppareilFromReservation(supabase, {
              appareilId: l.appareil_id, reservationId: resa.id, cityId: resa.city_id, motif: 'réservation remboursée',
            });
          }
        } catch (releaseErr) {
          console.error('[handleChargeRefunded] releaseAppareil échoué — appareil peut rester loué:', releaseErr.message);
          await pushToAdmin(supabase, {
            title: '⚠️ Sync stock échouée après remboursement',
            body: `Dossier ${resa.ref || resa.id} — vérifier manuellement le statut des appareils.`,
            tag: `release-failed-${resa.id}`,
          }).catch(() => {});
        }
      }
      // Sinon (livraison déjà faite) : le climatiseur est physiquement chez le
      // client — on ne touche pas à sa mission de récupération existante,
      // qui doit avoir lieu normalement. L'admin est alertée ci-dessous pour
      // vérifier elle-même, comme pour un remboursement Offre Privilège.
    }
  } else if (remboursementTotal && await handleOffrePrivilegeRefunded(supabase, piId, charge.amount_refunded || 0)) {
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
    body:  `${resa ? resa.ref + ' — ' : ''}${resa?.prenom || ''} ${resa?.nom || ''} — ${montant}${resa && remboursementTotal && livraisonDejaEffectuee ? ' — le climatiseur est chez le client, vérifie la mission de récupération.' : ''}`.trim(),
    tag:   `remboursement-${resa?.id || piId}`,
  });
  // Une commission déjà versée à un partenaire pour cette réservation devient
  // un litige à réconcilier — jusqu'ici visible seulement en badge, jamais
  // poussé au moment où ça arrive vraiment (audit automatisations, 2026-08-02).
  if (resa && remboursementTotal && resa.partenaire_commission_payee) {
    await pushToAdmin(supabase, {
      title: '⚠️ Litige commission partenaire',
      body:  `Dossier ${resa.ref || '?'} remboursé — une commission a déjà été versée au partenaire, à réconcilier dans l'onglet Partenaires.`,
      tag:   `partenaire-litige-${resa.id}`,
    });
  }
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
    // Tag unique par litige — un délai de réponse imposé par Stripe rend
    // critique de ne jamais en perdre un derrière un autre (audit
    // automatisations, 2026-08-02).
    tag:   `litige-stripe-${resa?.id || piId}`,
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
    let piId            = ''; // payment_intent ID canonique (pi_…) pour lookup réservation

    if (eventType === 'payment_intent.succeeded') {
      const intent = await stripe.paymentIntents.retrieve(obj.id || '');
      if (intent.status !== 'succeeded') return res.json({ received: true, skipped: 'not succeeded' });
      meta            = intent.metadata || {};
      amount          = (intent.amount / 100).toFixed(2) + ' €';
      email           = intent.receipt_email || meta.email || '';
      customerId      = (typeof intent.customer === 'string' ? intent.customer : '') || meta.customer_id || '';
      paymentMethodId = (typeof intent.payment_method === 'string' ? intent.payment_method : '') || '';
      piId            = intent.id;

    } else if (eventType === 'checkout.session.completed') {
      const session = await stripe.checkout.sessions.retrieve(obj.id || '');
      if (session.payment_status !== 'paid') return res.json({ received: true, skipped: 'not paid' });
      meta   = session.metadata || {};
      amount = (session.amount_total / 100).toFixed(2) + ' €';
      email  = session.customer_email || session.metadata?.email || '';
      // Extraire le payment_intent (pi_…) lié à la session Checkout — obj.id
      // vaut cs_… qui n'est jamais stocké dans reservations.stripe_payment_intent_id
      piId   = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id || '');

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
      const offreId = parseInt(meta.offre_id);
      if (!offreId) {
        console.error('[Offre privilège webhook] offre_id manquant dans metadata Stripe, piId:', piId);
        await pushToAdmin(getSupabase(), {
          title: '⚠️ Paiement Offre Privilège non traité',
          body: `offre_id absent dans les metadata Stripe — PI ${piId} — vérifier manuellement dans Stripe.`,
          tag: `offre-privilege-missing-${piId}`,
        }).catch(() => {});
      } else {
        try {
          await handleOffrePrivilegeAccepted(getSupabase(), offreId);
        } catch (e) {
          console.error('[Offre privilège webhook]', e.message);
        }
      }
      return res.status(200).json({ received: true, type: 'offre_privilege' });
    }

    // ── Réservation en base : confirmation + création des missions terrain ────
    // Ne doit jamais bloquer les emails existants en cas de souci Supabase.
    let confirmedResa = null;
    try {
      confirmedResa = await confirmReservationAndCreateLivraisons(getSupabase(), piId || obj.id || '');
    } catch (e) {
      console.error('[Reservation confirm]', e.message);
    }

    // ── Prolongation : flux distinct ─────────────────────────────────────────
    if (meta.type === 'prolongation') {
      // AbortController à 8 s : sans timeout, un Formspree lent bloquerait
      // tout le handler Stripe (Stripe réessaie après 30 s de silence) et
      // pourrait déclencher une double confirmation. Même garde sur les deux
      // appels Formspree de ce fichier.
      {
        const _fsCtrl = new AbortController();
        const _fsTimer = setTimeout(() => _fsCtrl.abort(), 8000);
        await fetch('https://formspree.io/f/mvzyngoy', {
          signal:  _fsCtrl.signal,
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
        clearTimeout(_fsTimer);
      }

      if (confirmedResa) {
        const prolongLang = meta.lang || confirmedResa.lang || 'fr';
        const rawEuros = parseFloat(amount) || 0;
        const prolongAmountFmt = prolongLang === 'en' || prolongLang === 'zh'
          ? '€' + rawEuros.toFixed(2)
          : rawEuros.toFixed(2).replace('.', ',') + ' €';
        await sendProlongationConfirmation(getSupabase(), {
          reservationId: confirmedResa.id,
          email,
          tel: meta.tel || '',
          prenom: meta.prenom || '',
          nom: meta.nom || '',
          jours: meta.jours || '1',
          dateRecuperation: meta.date_recuperation || '',
          creneau: meta.creneau || '',
          amount: prolongAmountFmt,
          lang: prolongLang,
          refOrigine: (meta.ref || meta.ref_origine || '').trim().toUpperCase(),
        });
      }

      // Mettre à jour date_fin de la réservation d'origine pour que l'espace client
      // et les éventuelles prolongations suivantes voient toujours la date réelle.
      // On identifie la réservation d'origine par reservation_origine_id — posé
      // côté serveur à la création de la prolongation (checkout-prolong.js/
      // prolong-pay.js), donc fiable et non manipulable, contrairement à
      // meta.ref (repris tel quel du body JSON envoyé par le navigateur,
      // voir index.html : ref:_prolongResa?.ref||'') qui servait jusqu'ici de
      // clé principale. Sans reservation_origine_id (réservation créée avant
      // la migration qui l'a introduit), repli sur le ref puis sur l'email —
      // tous deux bornés à la ville de la prolongation, comme _lib/paymentLink.js
      // et admin-reservations.js le font déjà pour ce même besoin, pour éviter
      // qu'un client ayant une réservation confirmée dans une autre ville ne
      // voie sa date_fin/son contrat mis à jour à tort.
      if (confirmedResa?.date_fin) {
        // prolong-pay.js stocke la ref d'origine dans meta.ref_origine (pas meta.ref)
        const origRef = (meta.ref || meta.ref_origine || '').trim().toUpperCase();
        try {
          // .not('source','eq','site_prolongation') exclut silencieusement les lignes
          // où source IS NULL (PostgREST : NOT x = y → NULL quand x est NULL).
          // On utilise .or() pour inclure explicitement les lignes sans source.
          let lookup = getSupabase().from('reservations').select('*').or('source.is.null,source.neq.site_prolongation');
          if (confirmedResa.reservation_origine_id) {
            lookup = lookup.eq('id', confirmedResa.reservation_origine_id);
          } else if (origRef) {
            lookup = lookup.eq('ref', origRef).eq('city_id', confirmedResa.city_id).limit(1);
          } else {
            // .eq('statut','confirmee') : sans lui, une réservation plus
            // récente mais annulée/en attente sous le même email passe devant
            // la vraie réservation active — sa date_fin n'est alors jamais
            // mise à jour (voir prolong-lookup.js).
            lookup = lookup.ilike('email', (email || '').trim()).eq('city_id', confirmedResa.city_id).eq('statut', 'confirmee').order('created_at', { ascending: false }).limit(1);
          }
          const { data: origResa } = await lookup.maybeSingle();
          if (origResa?.id) {
            await getSupabase().from('reservations').update({ date_fin: confirmedResa.date_fin }).eq('id', origResa.id);
            // Contrat mis à jour (nouvelle date de fin) + facture de l'extension —
            // sans ça, le contrat déjà en possession du client restait figé sur
            // la durée/le montant de sa réservation initiale (audit du 2026-07-27).
            try {
              await generateAndSendDocumentsAfterProlongation(getSupabase(), {
                origineResa: { ...origResa, date_fin: confirmedResa.date_fin },
                prolongationResa: confirmedResa,
              });
            } catch (e) {
              console.error('[Prolong webhook] documents mis à jour:', e.message);
            }
          }
        } catch (e) {
          console.error('[Prolong webhook] mise à jour date_fin:', e.message);
          // Alerte admin : orig.date_fin non mis à jour — la prochaine
          // prolongation recalculera sur une base obsolète (surfacturation).
          pushToAdmin(getSupabase(), {
            title: '⚠️ Prolongation — MAJ date_fin ratée',
            body: `Réservation origine introuvable ou update Supabase échoué. Vérifier manuellement. Prolongation : ${confirmedResa?.ref || '?'}`,
            tag: `prolong-datefin-err-${confirmedResa?.id || Date.now()}`,
          }).catch(() => {});
        }
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
    // 1. Notifier l'opérateur via Formspree (8 s de timeout — cf. bloc prolong)
    {
      const _fsCtrl2 = new AbortController();
      const _fsTimer2 = setTimeout(() => _fsCtrl2.abort(), 8000);
    await fetch('https://formspree.io/f/mvzyngoy', {
      signal:  _fsCtrl2.signal,
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
        date_recup_souhaitee: (confirmedResa?.date_recuperation_souhaitee || ''),
        creneau_recup:        (confirmedResa?.creneau_recuperation        || ''),
        fenetre:          meta.fenetre      || '',
        etage:            meta.etage        || '',
        ascenseur:        meta.ascenseur    || '',
        customer_id:      customerId,
        payment_method:   paymentMethodId,
      }),
    }).catch(e => console.error('[Formspree]', e.message));
    clearTimeout(_fsTimer2);
    } // fin bloc Formspree location standard

    // 2a. SMS de confirmation immédiat au client — idempotent : non renvoyé
    // si déjà tracé dans email_log OU si sendConfirmationCommunications a
    // déjà posé le verrou dans email_sent (deux tables différentes, d'où ce
    // double contrôle — sans lui, un SMS partait deux fois si email_log
    // n'avait pas encore été écrit quand le webhook repassait ici).
    if (meta.tel && confirmedResa) {
      const [{ data: smsDejaEnvoye }, { data: smsEmailSentLock }] = await Promise.all([
        getSupabase()
          .from('email_log')
          .select('id')
          .eq('reservation_id', confirmedResa.id)
          .eq('scenario', 'sms_confirmation')
          .eq('statut', 'envoye')
          .maybeSingle(),
        getSupabase()
          .from('email_sent')
          .select('reservation_id')
          .eq('reservation_id', confirmedResa.id)
          .eq('scenario', 'sms_confirmation')
          .maybeSingle(),
      ]);
      if (!smsDejaEnvoye && !smsEmailSentLock) {
        // Verrou pré-envoi : si deux instances Stripe traitent le même webhook
        // en parallèle, seule la première qui réussit l'INSERT envoie le SMS.
        const { error: smsPreLockErr } = await getSupabase().from('email_sent')
          .insert({ reservation_id: confirmedResa.id, scenario: 'sms_confirmation', sent_at: new Date().toISOString() });
        if (smsPreLockErr) {
          // Une autre instance a déjà acquis le verrou — ne pas envoyer
        } else {
        const lang = confirmedResa.lang || meta.lang || 'fr';
        const d = meta.date ? new Date(meta.date + 'T12:00:00Z') : null;
        let smsConfirmationContent;
        if (lang === 'en') {
          const dateStr = d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : '';
          smsConfirmationContent = `Loc'Air - Your booking is confirmed.${dateStr ? ' Delivery scheduled on ' + dateStr : ''}${meta.creneau ? ', time slot ' + meta.creneau : ''} Our technician will text you 30 minutes before arrival. Questions? Call us at +33 6 63 79 87 56.`;
        } else if (lang === 'zh') {
          const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
          const dateStr = d ? `${months[d.getUTCMonth()]}${d.getUTCDate()}日` : '';
          smsConfirmationContent = `Loc'Air - 您的预订已确认。${dateStr ? '配送日期：' + dateStr : ''}${meta.creneau ? '，时间段：' + meta.creneau : ''}技术员将在到达前30分钟发送短信通知您。如有疑问，请致电 +33 6 63 79 87 56。`;
        } else if (lang === 'ru') {
          const dateStr = d ? d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '';
          smsConfirmationContent = `Loc'Air - Ваше бронирование подтверждено.${dateStr ? ' Доставка ' + dateStr : ''}${meta.creneau ? ', интервал ' + meta.creneau : ''} Мастер отправит SMS за 30 минут до приезда. Вопросы? Звоните: +33 6 63 79 87 56.`;
        } else {
          const dateStr = d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '';
          smsConfirmationContent = `Loc'Air - Votre réservation est confirmée.${dateStr ? ' Livraison prévue le ' + dateStr : ''}${meta.creneau ? ', créneau ' + meta.creneau : ''} Notre technicien vous enverra un SMS 30 min avant son arrivée. Une question ? Appelez-nous au 06 63 79 87 56.`;
        }
        const smsResult = await sendBrevoSms({ to: meta.tel, content: smsConfirmationContent });
        if (!smsResult.ok) {
          await getSupabase().from('email_sent').delete()
            .eq('reservation_id', confirmedResa.id).eq('scenario', 'sms_confirmation').then(() => {}, () => {});
        }
        await getSupabase().from('email_log').insert({
          reservation_id: confirmedResa.id, scenario: 'sms_confirmation', canal: 'sms',
          destinataire: meta.tel, modele: 'sms_confirmation',
          statut: smsResult.ok ? 'envoye' : 'erreur',
          erreur: smsResult.ok ? null : String(smsResult.error || '').slice(0, 500),
          contenu: smsConfirmationContent,
        }).then(() => {}, () => {});
        } // fin else (verrou acquis)
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
