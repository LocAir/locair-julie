const Stripe = require('stripe');

// ── Brevo (emails client) ─────────────────────────────────────────────────────
async function sendBrevo({ to, subject, html, scheduledAt }) {
  if (!process.env.BREVO_API_KEY || !to) return;
  const body = {
    sender:      { name: "Loc'Air", email: 'contact@locair.fr' },
    to:          [{ email: to }],
    subject,
    htmlContent: html,
  };
  if (scheduledAt) body.scheduledAt = scheduledAt;
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
      body:    JSON.stringify(body),
    });
    if (!r.ok) console.error('[Brevo]', r.status, await r.text());
  } catch (e) {
    console.error('[Brevo]', e.message);
  }
}

// ── Calcul des dates programmées ──────────────────────────────────────────────
function scheduledISO(dateStr, offsetDays, hour = 9) {
  // dateStr format YYYY-MM-DD (depuis le metadata Stripe)
  if (!dateStr || !dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return null;
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + offsetDays);
  d.setUTCHours(hour - 1, 0, 0, 0); // heure Paris ~ UTC+1 (été UTC+2 → ajuster si besoin)
  if (d < new Date()) return null; // passé → ne pas programmer
  return d.toISOString();
}

// ── Templates email ────────────────────────────────────────────────────────────
function tplConfirmation({ ref, prenom, nom, adresse, date, creneau, duree, amount, installation }) {
  const dateRecup = scheduledISO(date, parseInt(duree) || 7, 10)
    ? (() => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + (parseInt(duree) || 7)); return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); })()
    : '';
  const dateLivr = date ? new Date(date + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Inter,Arial,sans-serif;background:#f4f0ea;margin:0;padding:0}
    .wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden}
    .head{background:#1b3a5f;padding:32px 32px 24px;text-align:center}
    .head h1{color:#fff;font-size:22px;margin:0 0 6px}
    .head p{color:rgba(255,255,255,.7);font-size:14px;margin:0}
    .body{padding:28px 32px}
    .ref{background:#f4f0ea;border-radius:10px;padding:14px 18px;text-align:center;margin-bottom:24px}
    .ref strong{font-size:18px;color:#1b3a5f;letter-spacing:.5px}
    .row{display:flex;padding:10px 0;border-bottom:1px solid #f0ede8}
    .row:last-child{border-bottom:none}
    .lbl{color:#888;font-size:13px;width:140px;flex-shrink:0}
    .val{color:#1a1a2e;font-size:13px;font-weight:600}
    .footer{background:#f4f0ea;padding:20px 32px;text-align:center;font-size:12px;color:#888}
    .btn{display:inline-block;background:#1b3a5f;color:#fff;padding:12px 28px;border-radius:100px;text-decoration:none;font-weight:700;font-size:14px;margin:20px 0}
  </style></head><body>
  <div class="wrap">
    <div class="head">
      <h1>✅ Réservation confirmée !</h1>
      <p>Merci ${prenom || ''}, votre paiement de ${amount} a bien été reçu.</p>
    </div>
    <div class="body">
      <div class="ref"><p style="margin:0 0 4px;color:#888;font-size:12px">VOTRE DOSSIER</p><strong>${ref}</strong></div>
      <div class="row"><span class="lbl">Client</span><span class="val">${prenom} ${nom}</span></div>
      <div class="row"><span class="lbl">Adresse</span><span class="val">${adresse}</span></div>
      <div class="row"><span class="lbl">Livraison</span><span class="val">${dateLivr}${creneau ? ' · ' + creneau : ''}</span></div>
      <div class="row"><span class="lbl">Durée</span><span class="val">${duree} jour${parseInt(duree) > 1 ? 's' : ''}${dateRecup ? ' — récupération ' + dateRecup : ''}</span></div>
      <div class="row"><span class="lbl">Installation</span><span class="val">${installation || 'Autonome'}</span></div>
      <div class="row"><span class="lbl">Montant</span><span class="val">${amount}</span></div>
      <p style="margin:24px 0 8px;font-size:13px;color:#444">Notre équipe vous confirmera le créneau exact par appel téléphonique le matin de la livraison.</p>
      <p style="margin:0;font-size:13px;color:#444">Le technicien vous appellera <strong>30 min avant d'arriver</strong>.</p>
      <a class="btn" href="https://wa.me/33663798756">Une question ? WhatsApp</a>
    </div>
    <div class="footer">© 2026 Loc'Air · Nice · <a href="https://www.locair.fr" style="color:#1b3a5f">www.locair.fr</a></div>
  </div></body></html>`;
}

function tplRappelJMoins1({ ref, prenom, adresse, creneau }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Inter,Arial,sans-serif;background:#f4f0ea;margin:0;padding:0}
    .wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden}
    .head{background:#0f766e;padding:28px 32px;text-align:center}
    .head h1{color:#fff;font-size:20px;margin:0 0 6px}
    .head p{color:rgba(255,255,255,.8);font-size:14px;margin:0}
    .body{padding:28px 32px;font-size:14px;color:#333;line-height:1.6}
    .box{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin:16px 0}
    .footer{background:#f4f0ea;padding:20px 32px;text-align:center;font-size:12px;color:#888}
    .btn{display:inline-block;background:#0f766e;color:#fff;padding:12px 28px;border-radius:100px;text-decoration:none;font-weight:700;font-size:14px;margin:16px 0}
  </style></head><body>
  <div class="wrap">
    <div class="head">
      <h1>📦 Demain, livraison de votre climatiseur !</h1>
      <p>Dossier ${ref} — ${prenom}</p>
    </div>
    <div class="body">
      <p>Bonjour ${prenom},</p>
      <p>Votre climatiseur mobile Loc'Air est livré <strong>demain</strong>.</p>
      <div class="box">
        <p style="margin:0 0 6px"><strong>📍 Adresse :</strong> ${adresse}</p>
        <p style="margin:0 0 6px"><strong>🕗 Créneau :</strong> ${creneau || '8h – 12h'}</p>
        <p style="margin:0"><strong>📞 Le technicien vous appelle 30 min avant d'arriver.</strong></p>
      </div>
      <p>Assurez-vous d'être présent ou qu'une personne puisse réceptionner l'appareil.</p>
      <a class="btn" href="https://wa.me/33663798756">Modifier le créneau</a>
    </div>
    <div class="footer">© 2026 Loc'Air · <a href="https://www.locair.fr" style="color:#0f766e">www.locair.fr</a></div>
  </div></body></html>`;
}

function tplAvis({ ref, prenom }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Inter,Arial,sans-serif;background:#f4f0ea;margin:0;padding:0}
    .wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden}
    .head{background:#1b3a5f;padding:28px 32px;text-align:center}
    .head h1{color:#fff;font-size:20px;margin:0 0 6px}
    .body{padding:28px 32px;font-size:14px;color:#333;line-height:1.6;text-align:center}
    .stars{font-size:32px;margin:12px 0}
    .footer{background:#f4f0ea;padding:20px 32px;text-align:center;font-size:12px;color:#888}
    .btn{display:inline-block;background:#f59e0b;color:#fff;padding:14px 32px;border-radius:100px;text-decoration:none;font-weight:700;font-size:15px;margin:16px 0}
  </style></head><body>
  <div class="wrap">
    <div class="head"><h1>⭐ Comment s'est passée votre location ?</h1></div>
    <div class="body">
      <p>Bonjour ${prenom},</p>
      <p>Nous espérons que votre climatiseur Loc'Air vous a apporté tout le confort souhaité !</p>
      <div class="stars">⭐⭐⭐⭐⭐</div>
      <p>Votre avis compte énormément et aide d'autres familles à nous faire confiance.</p>
      <a class="btn" href="https://g.page/r/CeJQrt2gLNNrEAE/review">Laisser un avis Google</a>
      <p style="font-size:12px;color:#888;margin-top:16px">Dossier ${ref} — Merci pour votre confiance !</p>
    </div>
    <div class="footer">© 2026 Loc'Air · <a href="https://www.locair.fr" style="color:#1b3a5f">www.locair.fr</a></div>
  </div></body></html>`;
}

function tplProlongation({ ref, prenom, dateRecup, duree }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Inter,Arial,sans-serif;background:#f4f0ea;margin:0;padding:0}
    .wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden}
    .head{background:#dc2626;padding:28px 32px;text-align:center}
    .head h1{color:#fff;font-size:20px;margin:0 0 6px}
    .head p{color:rgba(255,255,255,.8);font-size:14px;margin:0}
    .body{padding:28px 32px;font-size:14px;color:#333;line-height:1.6}
    .box{background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px 20px;margin:16px 0;text-align:center}
    .footer{background:#f4f0ea;padding:20px 32px;text-align:center;font-size:12px;color:#888}
    .btn{display:inline-block;background:#1b3a5f;color:#fff;padding:14px 32px;border-radius:100px;text-decoration:none;font-weight:700;font-size:14px;margin:16px 0}
  </style></head><body>
  <div class="wrap">
    <div class="head">
      <h1>🌡️ Votre location se termine dans 2 jours</h1>
      <p>Dossier ${ref}</p>
    </div>
    <div class="body">
      <p>Bonjour ${prenom},</p>
      <p>Votre climatiseur sera récupéré le <strong>${dateRecup}</strong>. La chaleur est toujours là ?</p>
      <div class="box">
        <p style="margin:0 0 8px;font-weight:700;font-size:15px">Prolongez votre location</p>
        <p style="margin:0;color:#666">Ajoutez des jours en quelques clics — dès 19 €/jour</p>
      </div>
      <a class="btn" href="https://www.locair.fr">Prolonger ma location</a>
      <p style="font-size:13px;color:#888">Si vous n'avez pas besoin de prolonger, notre équipe récupérera l'appareil à la date prévue. Le technicien vous contactera la veille.</p>
    </div>
    <div class="footer">© 2026 Loc'Air · <a href="https://www.locair.fr" style="color:#1b3a5f">www.locair.fr</a></div>
  </div></body></html>`;
}

// ── Webhook principal ─────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const body   = req.body || {};

  try {
    const eventType = body.type || '';
    const obj       = body?.data?.object || {};

    let meta   = null;
    let amount = null;
    let email  = null;

    if (eventType === 'payment_intent.succeeded') {
      const intent = await stripe.paymentIntents.retrieve(obj.id || '');
      if (intent.status !== 'succeeded') return res.json({ received: true, skipped: 'not succeeded' });
      meta   = intent.metadata || {};
      amount = (intent.amount / 100).toFixed(2) + ' €';
      email  = intent.receipt_email || '';

    } else if (eventType === 'checkout.session.completed') {
      const session = await stripe.checkout.sessions.retrieve(obj.id || '');
      if (session.payment_status !== 'paid') return res.json({ received: true, skipped: 'not paid' });
      meta   = session.metadata || {};
      amount = (session.amount_total / 100).toFixed(2) + ' €';
      email  = session.customer_email || '';

    } else {
      return res.json({ received: true, skipped: eventType });
    }

    const duree = parseInt(meta.duree) || 7;

    // 1. Notifier l'opérateur via Formspree
    fetch('https://formspree.io/f/mvzyngoy', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        _subject:       `✅ PAIEMENT — ${meta.ref || obj.id} — ${meta.prenom || ''} ${meta.nom || ''}`,
        _replyto:       email,
        statut:         `✅ Stripe confirmé — ${amount}`,
        stripe_id:      obj.id || '',
        ref:            meta.ref          || '',
        prenom:         meta.prenom       || '',
        nom:            meta.nom          || '',
        tel:            meta.tel          || '',
        email:          email,
        adresse:        meta.adresse      || '',
        duree:          meta.duree        || '',
        date_livraison: meta.date         || '',
        creneau:        meta.creneau      || '',
        installation:   meta.installation || '',
        fenetre:        meta.fenetre      || '',
        etage:          meta.etage        || '',
        ascenseur:      meta.ascenseur    || '',
      }),
    }).catch(e => console.error('[Formspree]', e.message));

    // 2. Email de confirmation immédiat au client
    await sendBrevo({
      to:      email,
      subject: `✅ Réservation confirmée — Dossier ${meta.ref || obj.id}`,
      html:    tplConfirmation({
        ref:          meta.ref || obj.id,
        prenom:       meta.prenom       || '',
        nom:          meta.nom          || '',
        adresse:      meta.adresse      || '',
        date:         meta.date         || '',
        creneau:      meta.creneau      || '',
        duree:        String(duree),
        amount,
        installation: meta.installation || 'Autonome',
      }),
    });

    // 3. Rappel J-1 (veille de la livraison à 18h)
    const j1 = scheduledISO(meta.date, -1, 18);
    if (j1) {
      await sendBrevo({
        to:          email,
        subject:     `📦 Demain, livraison de votre climatiseur Loc'Air`,
        html:        tplRappelJMoins1({ ref: meta.ref || obj.id, prenom: meta.prenom || '', adresse: meta.adresse || '', creneau: meta.creneau || '' }),
        scheduledAt: j1,
      });
    }

    // 4. Demande d'avis J+3 après livraison
    const j3 = scheduledISO(meta.date, 3, 10);
    if (j3) {
      await sendBrevo({
        to:          email,
        subject:     `⭐ Comment s'est passée votre location Loc'Air ?`,
        html:        tplAvis({ ref: meta.ref || obj.id, prenom: meta.prenom || '' }),
        scheduledAt: j3,
      });
    }

    // 5. Relance prolongation J-2 avant fin (si durée > 3 jours)
    if (duree > 3) {
      const jMoins2 = scheduledISO(meta.date, duree - 2, 10);
      const dateRecupStr = (() => {
        if (!meta.date || !meta.date.match(/^\d{4}-\d{2}-\d{2}$/)) return '';
        const d = new Date(meta.date + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() + duree);
        return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      })();
      if (jMoins2) {
        await sendBrevo({
          to:          email,
          subject:     `🌡️ Votre location Loc'Air se termine dans 2 jours`,
          html:        tplProlongation({ ref: meta.ref || obj.id, prenom: meta.prenom || '', dateRecup: dateRecupStr, duree: String(duree) }),
          scheduledAt: jMoins2,
        });
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Stripe webhook]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
