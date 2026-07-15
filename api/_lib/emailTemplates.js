// Templates des 8 scénarios email client, centralisés ici (jusqu'ici
// dispersés entre api/webhook.js et api/transporteur-action.js, avec un
// gabarit d'avis Google dupliqué presque à l'identique dans les deux). Chaque
// fonction reçoit un contexte simple (déjà résolu depuis Supabase par
// l'appelant — voir _lib/emailEngine.js) et retourne du HTML, sans jamais
// accéder au réseau ni à la base elle-même.
function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrap({ headColor = '#1b3a5f', title, intro, bodyHtml, ctaHref, ctaLabel }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    body{font-family:Inter,Arial,sans-serif;background:#f4f0ea;margin:0;padding:0}
    .wrap{max-width:560px;margin:16px auto;background:#fff;border-radius:16px;overflow:hidden}
    .head{background:${headColor};padding:28px 32px;text-align:center}
    .head h1{color:#fff;font-size:20px;margin:0 0 6px}
    .head p{color:rgba(255,255,255,.8);font-size:14px;margin:0}
    .body{padding:28px 32px;font-size:14px;color:#333;line-height:1.6}
    .box{background:#f4f0ea;border-radius:10px;padding:16px 20px;margin:16px 0}
    .btn{display:inline-block;background:${headColor};color:#fff;padding:12px 28px;border-radius:100px;text-decoration:none;font-weight:700;font-size:14px;margin:16px 0}
  </style></head><body>
  <div class="wrap">
    <div class="head"><h1>${title}</h1>${intro ? `<p>${intro}</p>` : ''}</div>
    <div class="body">${bodyHtml}${ctaHref ? `<a class="btn" href="${ctaHref}">${ctaLabel}</a>` : ''}</div>
  </div></body></html>`;
}

// 1. Confirmation de réservation
function tplConfirmation(ctx) {
  return wrap({
    title: '✅ Réservation confirmée !',
    intro: `Merci ${escHtml(ctx.prenom)}, votre paiement de ${escHtml(ctx.montantFmt)} a bien été reçu.`,
    bodyHtml: `
      <div class="box"><p style="margin:0 0 4px;color:#888;font-size:12px">VOTRE DOSSIER</p><strong style="font-size:18px;color:#1b3a5f">${escHtml(ctx.ref)}</strong></div>
      <p><strong>Client :</strong> ${escHtml(ctx.prenom)} ${escHtml(ctx.nom)}<br/>
      <strong>Adresse :</strong> ${escHtml(ctx.adresse)}<br/>
      <strong>Livraison :</strong> ${escHtml(ctx.dateDebutFmt)}${ctx.creneau ? ' · ' + escHtml(ctx.creneau) : ''}<br/>
      <strong>Récupération :</strong> ${escHtml(ctx.dateFinFmt)}<br/>
      <strong>Climatiseur :</strong> ${escHtml(ctx.modeleClimatiseur)}<br/>
      <strong>Installation :</strong> ${escHtml(ctx.installation || 'Autonome')}<br/>
      <strong>Montant :</strong> ${escHtml(ctx.montantFmt)}</p>
      <p style="font-size:13px;color:#444">Notre équipe vous confirmera le créneau exact par appel téléphonique le matin de la livraison. Le technicien vous appellera <strong>30 min avant d'arriver</strong>.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Une question ? WhatsApp',
  });
}

// 2. Suivi J-14
function tplSuiviJ14(ctx) {
  return wrap({
    headColor: '#0f766e',
    title: 'Votre climatiseur arrive dans 14 jours',
    bodyHtml: `
      <p>Bonjour ${escHtml(ctx.prenom)},</p>
      <p>Votre réservation Loc'Air (dossier ${escHtml(ctx.ref)}) est bien confirmée pour le <strong>${escHtml(ctx.dateDebutFmt)}</strong>.</p>
      <p>Rien à faire de votre côté pour l'instant — nous revenons vers vous quelques jours avant la livraison pour finaliser le créneau.</p>`,
    ctaHref: ctx.lienEspaceClient, ctaLabel: 'Consulter mon dossier',
  });
}

// 3. Préparation J-3
function tplPreparationJ3(ctx) {
  return wrap({
    headColor: '#0f766e',
    title: 'Votre livraison approche',
    bodyHtml: `
      <p>Bonjour ${escHtml(ctx.prenom)},</p>
      <p>Votre climatiseur Loc'Air arrive le <strong>${escHtml(ctx.dateDebutFmt)}</strong>${ctx.creneau ? ' (créneau ' + escHtml(ctx.creneau) + ')' : ''} à l'adresse : ${escHtml(ctx.adresse)}.</p>
      <div class="box"><p style="margin:0">Assurez-vous d'être présent (ou qu'une personne puisse réceptionner l'appareil) et que l'accès à votre fenêtre soit dégagé.</p></div>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Modifier le créneau',
  });
}

// 4. Rappel J-1 (livraison)
function tplRappelJ1(ctx) {
  return wrap({
    headColor: '#0f766e',
    title: 'Demain, livraison de votre climatiseur !',
    intro: `Dossier ${escHtml(ctx.ref)} — ${escHtml(ctx.prenom)}`,
    bodyHtml: `
      <p>Bonjour ${escHtml(ctx.prenom)},</p>
      <p>Votre climatiseur mobile Loc'Air est livré <strong>demain</strong>.</p>
      <div class="box">
        <p style="margin:0 0 6px"><strong>Adresse :</strong> ${escHtml(ctx.adresse)}</p>
        <p style="margin:0 0 6px"><strong>Créneau :</strong> ${escHtml(ctx.creneau || 'à confirmer (appel le matin)')}</p>
        <p style="margin:0"><strong>Le technicien vous appelle 30 min avant d'arriver.</strong></p>
      </div>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Modifier le créneau',
  });
}

// 5. Post-installation
function tplPostInstallation(ctx) {
  return wrap({
    title: '✅ Votre climatiseur est installé !',
    intro: `Dossier ${escHtml(ctx.ref)}`,
    bodyHtml: `
      <p>Bonjour ${escHtml(ctx.prenom)},</p>
      <p>Votre ${escHtml(ctx.modeleClimatiseur)} est installé et prêt à l'emploi.</p>
      <p><strong>Votre facture</strong> vous a déjà été envoyée par email juste après votre paiement — pensez à vérifier vos spams si vous ne la trouvez pas.</p>
      <p>Un souci, une question sur l'utilisation ? Notre équipe reste joignable à tout moment.</p>
      <div class="box"><p style="margin:0">📖 Besoin d'un rappel sur l'utilisation ? <a href="${ctx.lienTutoriel}" style="color:#1b3a5f">Consultez notre guide</a>.</p></div>
      <p style="font-size:13px;color:#888">Si vous avez une minute dès maintenant, votre avis nous aide beaucoup :</p>`,
    ctaHref: 'https://g.page/r/CeJQrt2gLNNrEAE/review', ctaLabel: 'Laisser un avis Google ⭐',
  });
}

// 6. Avant fin de location (proposition de prolongation)
function tplAvantFinLocation(ctx) {
  return wrap({
    title: 'Votre location se termine bientôt',
    intro: `Dossier ${escHtml(ctx.ref)}`,
    bodyHtml: `
      <p>Bonjour ${escHtml(ctx.prenom)},</p>
      <p>Votre climatiseur sera récupéré le <strong>${escHtml(ctx.dateFinFmt)}</strong>. La chaleur est toujours là ?</p>
      <div class="box" style="text-align:center">
        <p style="margin:0 0 8px;font-weight:700;font-size:15px">Prolongez votre location</p>
        <p style="margin:0;color:#666">Ajoutez des jours en quelques clics avec votre numéro de commande (${escHtml(ctx.ref)})</p>
      </div>
      <p style="font-size:13px;color:#888">Si vous n'avez pas besoin de prolonger, notre équipe récupérera l'appareil à la date prévue.</p>`,
    ctaHref: ctx.lienProlongation, ctaLabel: 'Prolonger ma location',
  });
}

// Rappel récupération (conservé de l'existant, hors des 7 scénarios demandés)
function tplRappelRecuperation(ctx) {
  return wrap({
    title: 'Récupération de votre climatiseur demain',
    intro: `Dossier ${escHtml(ctx.ref)}`,
    bodyHtml: `
      <p>Bonjour ${escHtml(ctx.prenom)},</p>
      <p>Votre location Loc'Air se termine demain (<strong>${escHtml(ctx.dateFinFmt)}</strong>). Notre technicien viendra récupérer l'appareil.</p>
      <div class="box"><p style="margin:0 0 6px"><strong>Adresse :</strong> ${escHtml(ctx.adresse)}</p><p style="margin:0">Nous vous appellerons le matin pour confirmer le créneau.</p></div>
      <p>Merci de préparer l'appareil (débranché, gaine récupérée si possible).</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Nous contacter',
  });
}

// 7. Fin de location (remerciement + avis)
function tplFinLocation(ctx) {
  return wrap({
    title: '✅ Location terminée',
    bodyHtml: `
      <p style="text-align:center">Bonjour ${escHtml(ctx.prenom)},</p>
      <p style="text-align:center">Notre technicien a récupéré votre climatiseur. Merci d'avoir choisi Loc'Air !</p>
      <p style="text-align:center;font-size:13px;color:#666">Dossier ${escHtml(ctx.ref)}</p>
      <p style="text-align:center;font-size:13px;color:#444">Si vous avez une minute, votre avis aide d'autres familles à nous faire confiance :</p>`,
    ctaHref: 'https://g.page/r/CeJQrt2gLNNrEAE/review', ctaLabel: 'Laisser un avis Google ⭐',
  });
}

module.exports = {
  escHtml,
  tplConfirmation, tplSuiviJ14, tplPreparationJ3, tplRappelJ1,
  tplPostInstallation, tplAvantFinLocation, tplRappelRecuperation, tplFinLocation,
};
