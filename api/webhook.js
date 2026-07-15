const Stripe = require('stripe');
const { getSupabase } = require('./_lib/supabase');
const { confirmReservationAndCreateLivraisons } = require('./_lib/reservations');
const { sendBrevoEmail, sendBrevoSms } = require('./_lib/brevo');
const { pushToAdmin } = require('./_lib/push');
const { generateAndSendDocuments } = require('./_lib/documents');
const { sendScenarioEmail } = require('./_lib/emailEngine');
const { escHtml } = require('./_lib/emailTemplates');

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
      statut: 'ouvert',
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

async function handleChargeRefunded(supabase, charge) {
  const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : (charge.payment_intent?.id || '');
  const resa = await findReservationByPaymentIntent(supabase, piId);
  const montant = (charge.amount_refunded / 100).toFixed(2) + ' €';
  if (resa) {
    await supabase.from('reservations').update({ statut: 'remboursee' }).eq('id', resa.id);
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

// Confirmation de prolongation : transaction distincte des 8 scénarios du
// moteur central (_lib/emailEngine.js), qui couvrent le cycle de vie de la
// réservation d'origine — reste un envoi immédiat ad hoc, hors historique
// email_log pour l'instant (voir rapport de fin de module).
function tplProlongConfirmation({ prenom, nom, jours, date_recuperation, creneau, amount }) {
  const jNum = Number(jours) || 1;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    body{font-family:Inter,Arial,sans-serif;background:#f4f0ea;margin:0;padding:0}
    .wrap{max-width:560px;margin:16px auto;background:#fff;border-radius:16px;overflow:hidden}
    .head{background:#0f766e;padding:32px 32px 24px;text-align:center}
    .head h1{color:#fff;font-size:22px;margin:0 0 6px}
    .head p{color:rgba(255,255,255,.75);font-size:14px;margin:0}
    .body{padding:28px 32px}
    .row{padding:10px 0;border-bottom:1px solid #f0ede8}
    .row:last-child{border-bottom:none}
    .lbl{color:#888;font-size:13px;display:block}
    .val{color:#1a1a2e;font-size:13px;font-weight:600;display:block}
    .footer{background:#f4f0ea;padding:20px 32px;text-align:center;font-size:12px;color:#888}
    .btn{display:inline-block;background:#0f766e;color:#fff;padding:12px 28px;border-radius:100px;text-decoration:none;font-weight:700;font-size:14px;margin:20px 0}
  </style></head><body>
  <div class="wrap">
    <div class="head">
      <h1>✅ Prolongation confirmée !</h1>
      <p>Merci ${escHtml(prenom || '')}, votre paiement de ${escHtml(amount)} a bien été reçu.</p>
    </div>
    <div class="body">
      <div class="row"><span class="lbl">Client</span><span class="val">${escHtml(prenom || '')} ${escHtml(nom || '')}</span></div>
      <div class="row"><span class="lbl">Jours supplémentaires</span><span class="val">${jNum} jour${jNum > 1 ? 's' : ''}</span></div>
      <div class="row"><span class="lbl">Récupération le</span><span class="val">${escHtml(date_recuperation || '—')}</span></div>
      <div class="row"><span class="lbl">Créneau</span><span class="val">${escHtml(creneau || '—')}</span></div>
      <div class="row"><span class="lbl">Montant payé</span><span class="val">${escHtml(amount)}</span></div>
      <p style="margin:24px 0 8px;font-size:13px;color:#444">Notre technicien vous contactera la veille de la récupération pour confirmer le créneau.</p>
      <a class="btn" href="https://wa.me/33663798756">Une question ? WhatsApp</a>
    </div>
    <div class="footer">© 2026 Loc'Air · Nice · <a href="https://www.locair.fr" style="color:#0f766e">www.locair.fr</a></div>
  </div></body></html>`;
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
    console.warn('[Webhook] STRIPE_WEBHOOK_SECRET absent — vérification de signature désactivée');
    body = JSON.parse(rawBody.toString('utf8'));
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

      await sendBrevoEmail({
        to:      email,
        subject: `✅ Prolongation confirmée — ${meta.jours} jour${Number(meta.jours) > 1 ? 's' : ''} ajoutés`,
        html:    tplProlongConfirmation({
          prenom:            meta.prenom            || '',
          nom:               meta.nom               || '',
          jours:             meta.jours             || '1',
          date_recuperation: meta.date_recuperation || '',
          creneau:           meta.creneau           || '',
          amount,
        }),
      });

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
      const dateStr = meta.date
        ? new Date(meta.date + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
        : '';
      await sendBrevoSms({
        to:      meta.tel,
        content: `Loc'Air : réservation confirmée ✅${dateStr ? ' Livraison le ' + dateStr : ''}${meta.creneau ? ' · ' + meta.creneau : ''}. Votre technicien vous appellera 30 min avant d'arriver. Questions : 06 63 79 87 56`,
      }).catch(() => {});
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
