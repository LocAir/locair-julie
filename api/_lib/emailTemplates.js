// Templates des scénarios email client — chaque fonction reçoit un ctx
// (déjà résolu par emailEngine.js) et retourne du HTML prêt à l'envoi.
// ctx.lang = 'fr' | 'en' | 'zh'  (défaut : 'fr')
const { promoCodeForPrenom, REFERRAL_PCT } = require('./promo');

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Habillage visuel unique (identité de marque) — même structure et mêmes
// paramètres qu'avant (headColor/title/intro/bodyHtml/ctaHref/ctaLabel),
// seule la mise en forme change : pile de polices système (rendu natif fiable
// sur tous les clients mail, Inter ne charge presque jamais), profondeur de
// carte (ombre douce), hiérarchie de couleurs affinée, encarts ".box" avec
// liseré de marque, bouton avec un léger relief. Passe purement visuelle —
// aucun contenu, aucun paramètre, aucune logique d'envoi n'est modifié.
function wrap({ headColor = '#1b3a5f', title, intro, bodyHtml, ctaHref, ctaLabel }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#eee8dd;margin:0;padding:0;-webkit-font-smoothing:antialiased}
    .wrap{max-width:560px;margin:24px auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(27,58,95,.10)}
    .head{background:${headColor};padding:34px 32px 30px;text-align:center}
    .head h1{color:#fff;font-size:21px;line-height:1.35;margin:0 0 8px;font-weight:700;letter-spacing:-.01em}
    .head p{color:rgba(255,255,255,.82);font-size:14px;margin:0;font-weight:500}
    .body{padding:32px 32px 30px;font-size:15px;color:#2b2b2e;line-height:1.65}
    .body p{margin:0 0 14px}
    .body p:last-child{margin-bottom:0}
    .box{background:#f7f3ea;border-left:3px solid ${headColor};border-radius:8px;padding:16px 20px;margin:18px 0}
    .box a{text-decoration:none}
    .btn{display:inline-block;background:${headColor};color:#fff;padding:13px 30px;border-radius:100px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:.01em;margin:22px 0 4px;box-shadow:0 3px 10px rgba(27,58,95,.28)}
    .btn:hover{opacity:.92}
  </style></head><body>
  <div class="wrap">
    <div class="head"><h1>${title}</h1>${intro ? `<p>${intro}</p>` : ''}</div>
    <div class="body">${bodyHtml}${ctaHref ? `<a class="btn" href="${ctaHref}">${ctaLabel}</a>` : ''}</div>
  </div></body></html>`;
}

// 1. Confirmation de réservation
function tplConfirmation(ctx) {
  const l = ctx.lang || 'fr';
  const p = escHtml(ctx.prenom), ref = escHtml(ctx.ref);
  if (l === 'en') return wrap({
    title: '✅ Booking confirmed!',
    intro: `Thank you ${p}, your payment of ${escHtml(ctx.montantFmt)} has been received.`,
    bodyHtml: `
      <div class="box"><p style="margin:0 0 4px;color:#888;font-size:12px">YOUR BOOKING</p><strong style="font-size:18px;color:#1b3a5f">${ref}</strong></div>
      <p><strong>Name:</strong> ${p} ${escHtml(ctx.nom)}<br/>
      <strong>Address:</strong> ${escHtml(ctx.adresse)}<br/>
      <strong>Delivery:</strong> ${escHtml(ctx.dateDebutFmt)}${ctx.creneau ? ' · ' + escHtml(ctx.creneau) : ''}<br/>
      <strong>Collection:</strong> ${escHtml(ctx.dateRecupFmt)}<br/>
      <strong>Unit:</strong> ${escHtml(ctx.modeleClimatiseur)}<br/>
      <strong>Installation:</strong> ${escHtml(ctx.installation || 'Self-install')}<br/>
      <strong>Amount:</strong> ${escHtml(ctx.montantFmt)}</p>
      <p style="font-size:13px;color:#444">The technician will call you <strong>30 minutes before arriving</strong>.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'A question? WhatsApp',
  });
  if (l === 'zh') return wrap({
    title: '✅ 预订已确认！',
    intro: `感谢 ${p}，我们已收到您的付款 ${escHtml(ctx.montantFmt)}。`,
    bodyHtml: `
      <div class="box"><p style="margin:0 0 4px;color:#888;font-size:12px">您的订单</p><strong style="font-size:18px;color:#1b3a5f">${ref}</strong></div>
      <p><strong>姓名：</strong>${p} ${escHtml(ctx.nom)}<br/>
      <strong>地址：</strong>${escHtml(ctx.adresse)}<br/>
      <strong>配送日期：</strong>${escHtml(ctx.dateDebutFmt)}${ctx.creneau ? ' · ' + escHtml(ctx.creneau) : ''}<br/>
      <strong>取回日期：</strong>${escHtml(ctx.dateRecupFmt)}<br/>
      <strong>设备：</strong>${escHtml(ctx.modeleClimatiseur)}<br/>
      <strong>安装方式：</strong>${escHtml(ctx.installation || '自行安装')}<br/>
      <strong>金额：</strong>${escHtml(ctx.montantFmt)}</p>
      <p style="font-size:13px;color:#444">技术员将在<strong>到达前30分钟</strong>致电通知您。</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: '有疑问？WhatsApp',
  });
  return wrap({
    title: '✅ Réservation confirmée !',
    intro: `Merci ${p}, votre paiement de ${escHtml(ctx.montantFmt)} a bien été reçu.`,
    bodyHtml: `
      <div class="box"><p style="margin:0 0 4px;color:#888;font-size:12px">VOTRE DOSSIER</p><strong style="font-size:18px;color:#1b3a5f">${ref}</strong></div>
      <p><strong>Client :</strong> ${p} ${escHtml(ctx.nom)}<br/>
      <strong>Adresse :</strong> ${escHtml(ctx.adresse)}<br/>
      <strong>Livraison :</strong> ${escHtml(ctx.dateDebutFmt)}${ctx.creneau ? ' · ' + escHtml(ctx.creneau) : ''}<br/>
      <strong>Récupération :</strong> ${escHtml(ctx.dateRecupFmt)}<br/>
      <strong>Climatiseur :</strong> ${escHtml(ctx.modeleClimatiseur)}<br/>
      <strong>Installation :</strong> ${escHtml(ctx.installation || 'Autonome')}<br/>
      <strong>Montant :</strong> ${escHtml(ctx.montantFmt)}</p>
      <p style="font-size:13px;color:#444">Le technicien vous appellera <strong>30 min avant d'arriver</strong>.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Une question ? WhatsApp',
  });
}

// 2. Suivi J-14
function tplSuiviJ14(ctx) {
  const l = ctx.lang || 'fr';
  const p = escHtml(ctx.prenom), ref = escHtml(ctx.ref);
  if (l === 'en') return wrap({
    title: 'Your AC arrives in 14 days',
    intro: `Booking ref ${ref}`,
    bodyHtml: `
      <p>Hello ${p},</p>
      <p>Your Loc'Air booking (ref ${ref}) is confirmed for <strong>${escHtml(ctx.dateDebutFmt)}</strong>.</p>
      <p>Nothing to do for now — we'll get back to you a few days before delivery to confirm the time slot.</p>`,
    ctaHref: ctx.lienEspaceClient, ctaLabel: 'Contact us',
  });
  if (l === 'zh') return wrap({
    title: '您的空调将在14天后送达',
    intro: `订单编号 ${ref}`,
    bodyHtml: `
      <p>您好 ${p}，</p>
      <p>您的 Loc'Air 预订（订单 ${ref}）已确认，配送日期为 <strong>${escHtml(ctx.dateDebutFmt)}</strong>。</p>
      <p>目前无需任何操作——我们将在配送前几天联系您确认具体时间。</p>`,
    ctaHref: ctx.lienEspaceClient, ctaLabel: '联系我们',
  });
  return wrap({
    title: 'Votre climatiseur arrive dans 14 jours',
    intro: `Dossier ${ref}`,
    bodyHtml: `
      <p>Bonjour ${p},</p>
      <p>Votre réservation Loc'Air (dossier ${ref}) est bien confirmée pour le <strong>${escHtml(ctx.dateDebutFmt)}</strong>.</p>
      <p>Rien à faire de votre côté pour l'instant — nous revenons vers vous quelques jours avant la livraison pour finaliser le créneau.</p>`,
    ctaHref: ctx.lienEspaceClient, ctaLabel: 'Nous contacter',
  });
}

// 3. Préparation J-3
function tplPreparationJ3(ctx) {
  const l = ctx.lang || 'fr';
  const p = escHtml(ctx.prenom), ref = escHtml(ctx.ref);
  if (l === 'en') return wrap({
    title: 'Your delivery is coming up',
    intro: `Booking ref ${ref}`,
    bodyHtml: `
      <p>Hello ${p},</p>
      <p>Your Loc'Air AC is being delivered on <strong>${escHtml(ctx.dateDebutFmt)}</strong>${ctx.creneau ? ' (slot ' + escHtml(ctx.creneau) + ')' : ''} to: ${escHtml(ctx.adresse)}.</p>
      <div class="box"><p style="margin:0">Please make sure you (or someone you trust) are available to receive the unit, and that the window area is clear and accessible.</p></div>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Change time slot',
  });
  if (l === 'zh') return wrap({
    title: '您的配送即将到来',
    intro: `订单编号 ${ref}`,
    bodyHtml: `
      <p>您好 ${p}，</p>
      <p>您的 Loc'Air 空调将于 <strong>${escHtml(ctx.dateDebutFmt)}</strong>${ctx.creneau ? '（时间段：' + escHtml(ctx.creneau) + '）' : ''} 配送至：${escHtml(ctx.adresse)}。</p>
      <div class="box"><p style="margin:0">请确保您（或受托人）在场接收设备，并确保窗户区域畅通易达。</p></div>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: '更改时间段',
  });
  return wrap({
    title: 'Votre livraison approche',
    intro: `Dossier ${ref}`,
    bodyHtml: `
      <p>Bonjour ${p},</p>
      <p>Votre climatiseur Loc'Air arrive le <strong>${escHtml(ctx.dateDebutFmt)}</strong>${ctx.creneau ? ' (créneau ' + escHtml(ctx.creneau) + ')' : ''} à l'adresse : ${escHtml(ctx.adresse)}.</p>
      <div class="box"><p style="margin:0">Assurez-vous d'être présent (ou qu'une personne puisse réceptionner l'appareil) et que l'accès à votre fenêtre soit dégagé.</p></div>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Modifier le créneau',
  });
}

// 4. Rappel J-1 (livraison)
function tplRappelJ1(ctx) {
  const l = ctx.lang || 'fr';
  const p = escHtml(ctx.prenom), ref = escHtml(ctx.ref);
  if (l === 'en') return wrap({
    title: 'Tomorrow — your AC is delivered!',
    intro: `Booking ref ${ref}`,
    bodyHtml: `
      <p>Hello ${p},</p>
      <p>Your Loc'Air mobile AC will be delivered <strong>tomorrow</strong>.</p>
      <div class="box">
        <p style="margin:0 0 6px"><strong>Address:</strong> ${escHtml(ctx.adresse)}</p>
        <p style="margin:0 0 6px"><strong>Time slot:</strong> ${escHtml(ctx.creneau || 'to be confirmed (call in the morning)')}</p>
        <p style="margin:0"><strong>The technician will call you 30 minutes before arriving.</strong></p>
      </div>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Change time slot',
  });
  if (l === 'zh') return wrap({
    title: '明天——您的空调将送达！',
    intro: `订单编号 ${ref}`,
    bodyHtml: `
      <p>您好 ${p}，</p>
      <p>您的 Loc'Air 移动空调将于<strong>明天</strong>送达。</p>
      <div class="box">
        <p style="margin:0 0 6px"><strong>地址：</strong>${escHtml(ctx.adresse)}</p>
        <p style="margin:0 0 6px"><strong>时间段：</strong>${escHtml(ctx.creneau || '待确认（当天早上来电）')}</p>
        <p style="margin:0"><strong>技术员将在到达前30分钟来电通知。</strong></p>
      </div>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: '更改时间段',
  });
  return wrap({
    title: 'Demain, livraison de votre climatiseur !',
    intro: `Dossier ${ref}`,
    bodyHtml: `
      <p>Bonjour ${p},</p>
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
  const l = ctx.lang || 'fr';
  const p = escHtml(ctx.prenom), ref = escHtml(ctx.ref);
  if (l === 'en') return wrap({
    title: '✅ Your AC is installed!',
    intro: `Booking ref ${ref}`,
    bodyHtml: `
      <p>Hello ${p},</p>
      <p>Your ${escHtml(ctx.modeleClimatiseur)} is installed and ready to use.</p>
      <p>Any issue or question about how to use it? Our team is reachable at any time.</p>
      <div class="box"><p style="margin:0">📖 Need a refresher? <a href="${ctx.lienTutoriel}" style="color:#1b3a5f">Check our FAQ guide</a>.</p></div>
      <p style="font-size:13px;color:#888">If you have a minute, your review helps other families trust us:</p>`,
    ctaHref: 'https://g.page/r/CeJQrt2gLNNrEAE/review', ctaLabel: 'Leave a Google review ⭐',
  });
  if (l === 'zh') return wrap({
    title: '✅ 您的空调已安装！',
    intro: `订单编号 ${ref}`,
    bodyHtml: `
      <p>您好 ${p}，</p>
      <p>您的 ${escHtml(ctx.modeleClimatiseur)} 已安装完毕，可以使用。</p>
      <p>如有任何问题或使用疑问，请随时联系我们的团队。</p>
      <div class="box"><p style="margin:0">📖 需要使用说明？<a href="${ctx.lienTutoriel}" style="color:#1b3a5f">查看我们的常见问题</a>。</p></div>
      <p style="font-size:13px;color:#888">如果您有时间，您的评价将帮助更多家庭了解我们：</p>`,
    ctaHref: 'https://g.page/r/CeJQrt2gLNNrEAE/review', ctaLabel: '留下 Google 评价 ⭐',
  });
  return wrap({
    title: '✅ Votre climatiseur est installé !',
    intro: `Dossier ${ref}`,
    bodyHtml: `
      <p>Bonjour ${p},</p>
      <p>Votre ${escHtml(ctx.modeleClimatiseur)} est installé et prêt à l'emploi.</p>
      <p>Un souci, une question sur l'utilisation ? Notre équipe reste joignable à tout moment.</p>
      <div class="box"><p style="margin:0">📖 Besoin d'un rappel sur l'utilisation ? <a href="${ctx.lienTutoriel}" style="color:#1b3a5f">Consultez notre guide</a>.</p></div>
      <p style="font-size:13px;color:#888">Si vous avez une minute dès maintenant, votre avis nous aide beaucoup :</p>`,
    ctaHref: 'https://g.page/r/CeJQrt2gLNNrEAE/review', ctaLabel: 'Laisser un avis Google ⭐',
  });
}

// 6. Avant fin de location (proposition de prolongation)
function tplAvantFinLocation(ctx) {
  const l = ctx.lang || 'fr';
  const p = escHtml(ctx.prenom), ref = escHtml(ctx.ref);
  if (l === 'en') return wrap({
    title: 'Your rental is ending soon',
    intro: `Booking ref ${ref}`,
    bodyHtml: `
      <p>Hello ${p},</p>
      <p>Your AC will be collected on <strong>${escHtml(ctx.dateRecupFmt)}</strong>. Still feeling the heat?</p>
      <div class="box" style="text-align:center">
        <p style="margin:0 0 8px;font-weight:700;font-size:15px">Extend your rental</p>
        <p style="margin:0;color:#666">Add days in a few clicks using your booking ref (${escHtml(ctx.ref)})</p>
      </div>
      <p style="font-size:13px;color:#888">If you don't need to extend, our team will collect the unit on the scheduled date.</p>`,
    ctaHref: ctx.lienProlongation, ctaLabel: 'Extend my rental',
  });
  if (l === 'zh') return wrap({
    title: '您的租赁即将结束',
    intro: `订单编号 ${ref}`,
    bodyHtml: `
      <p>您好 ${p}，</p>
      <p>您的空调将于 <strong>${escHtml(ctx.dateRecupFmt)}</strong> 取回。天气还是很热吗？</p>
      <div class="box" style="text-align:center">
        <p style="margin:0 0 8px;font-weight:700;font-size:15px">续租延长</p>
        <p style="margin:0;color:#666">使用您的订单编号（${escHtml(ctx.ref)}）几步即可续租</p>
      </div>
      <p style="font-size:13px;color:#888">如不需要续租，我们的团队将按计划日期取回设备。</p>`,
    ctaHref: ctx.lienProlongation, ctaLabel: '续租延长',
  });
  return wrap({
    title: 'Votre location se termine bientôt',
    intro: `Dossier ${ref}`,
    bodyHtml: `
      <p>Bonjour ${p},</p>
      <p>Votre climatiseur sera récupéré le <strong>${escHtml(ctx.dateRecupFmt)}</strong>. La chaleur est toujours là ?</p>
      <div class="box" style="text-align:center">
        <p style="margin:0 0 8px;font-weight:700;font-size:15px">Prolongez votre location</p>
        <p style="margin:0;color:#666">Ajoutez des jours en quelques clics avec votre numéro de commande (${escHtml(ctx.ref)})</p>
      </div>
      <p style="font-size:13px;color:#888">Si vous n'avez pas besoin de prolonger, notre équipe récupérera l'appareil à la date prévue.</p>`,
    ctaHref: ctx.lienProlongation, ctaLabel: 'Prolonger ma location',
  });
}

// 7. Rappel récupération J-1
function tplRappelRecuperation(ctx) {
  const l = ctx.lang || 'fr';
  const p = escHtml(ctx.prenom), ref = escHtml(ctx.ref);
  if (l === 'en') return wrap({
    title: 'AC collection tomorrow',
    intro: `Booking ref ${ref}`,
    bodyHtml: `
      <p>Hello ${p},</p>
      <p>Your Loc'Air rental ends today (<strong>${escHtml(ctx.dateFinFmt)}</strong>). Our technician will come to collect the unit tomorrow (<strong>${escHtml(ctx.dateRecupFmt)}</strong>).</p>
      <div class="box"><p style="margin:0 0 6px"><strong>Address:</strong> ${escHtml(ctx.adresse)}</p><p style="margin:0">We will call you in the morning to confirm the exact time slot.</p></div>
      <p>Please have the unit unplugged and the duct rolled up if possible.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Contact us',
  });
  if (l === 'zh') return wrap({
    title: '明天将取回您的空调',
    intro: `订单编号 ${ref}`,
    bodyHtml: `
      <p>您好 ${p}，</p>
      <p>您的 Loc'Air 租赁今天结束（<strong>${escHtml(ctx.dateFinFmt)}</strong>）。我们的技术员明天（<strong>${escHtml(ctx.dateRecupFmt)}</strong>）将前来取回设备。</p>
      <div class="box"><p style="margin:0 0 6px"><strong>地址：</strong>${escHtml(ctx.adresse)}</p><p style="margin:0">我们将于当天早上来电确认具体时间。</p></div>
      <p>请提前拔掉电源，如可能请将排风管卷好。</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: '联系我们',
  });
  return wrap({
    title: 'Récupération de votre climatiseur demain',
    intro: `Dossier ${ref}`,
    bodyHtml: `
      <p>Bonjour ${p},</p>
      <p>Votre location Loc'Air se termine aujourd'hui (<strong>${escHtml(ctx.dateFinFmt)}</strong>). Notre technicien viendra récupérer l'appareil demain (<strong>${escHtml(ctx.dateRecupFmt)}</strong>).</p>
      <div class="box"><p style="margin:0 0 6px"><strong>Adresse :</strong> ${escHtml(ctx.adresse)}</p><p style="margin:0">Nous vous appellerons le matin pour confirmer le créneau.</p></div>
      <p>Merci de préparer l'appareil (débranché, gaine récupérée si possible).</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Nous contacter',
  });
}

// 8. Fin de location (remerciement + code fidélité + avis)
function tplFinLocation(ctx) {
  const l = ctx.lang || 'fr';
  const p = escHtml(ctx.prenom), ref = escHtml(ctx.ref);
  const code = promoCodeForPrenom(ctx.prenom);
  if (l === 'en') return wrap({
    title: '✅ Rental complete',
    intro: `Booking ref ${ref}`,
    bodyHtml: `
      <p>Hello ${p},</p>
      <p>Our technician has collected your AC. Thank you for choosing Loc'Air!</p>
      <div class="box" style="text-align:center">
        <p style="margin:0 0 6px">As a thank-you, enjoy <strong>${REFERRAL_PCT}% off</strong> your next booking with the code</p>
        <p style="margin:0 0 6px;font-size:20px;font-weight:800;letter-spacing:.05em;color:#1b3a5f">${escHtml(code)}</p>
        <p style="margin:0;font-size:13px;color:#666">You can also share it with friends — the code is their first name + 30 (e.g. JEAN30).</p>
      </div>
      <p style="font-size:13px;color:#444">If you have a minute, your review helps other families trust us:</p>`,
    ctaHref: 'https://g.page/r/CeJQrt2gLNNrEAE/review', ctaLabel: 'Leave a Google review ⭐',
  });
  if (l === 'zh') return wrap({
    title: '✅ 租赁已完成',
    intro: `订单编号 ${ref}`,
    bodyHtml: `
      <p>您好 ${p}，</p>
      <p>我们的技术员已取回您的空调。感谢您选择 Loc'Air！</p>
      <div class="box" style="text-align:center">
        <p style="margin:0 0 6px">作为感谢，使用以下优惠码可享 <strong>-${REFERRAL_PCT}%</strong> 下次预订折扣</p>
        <p style="margin:0 0 6px;font-size:20px;font-weight:800;letter-spacing:.05em;color:#1b3a5f">${escHtml(code)}</p>
        <p style="margin:0;font-size:13px;color:#666">此优惠码也可与朋友分享——优惠码为朋友姓名加上30（例如：JEAN30）。</p>
      </div>
      <p style="font-size:13px;color:#444">如有时间，您的评价将帮助更多家庭了解我们：</p>`,
    ctaHref: 'https://g.page/r/CeJQrt2gLNNrEAE/review', ctaLabel: '留下 Google 评价 ⭐',
  });
  return wrap({
    title: '✅ Location terminée',
    intro: `Dossier ${ref}`,
    bodyHtml: `
      <p>Bonjour ${p},</p>
      <p>Notre technicien a récupéré votre climatiseur. Merci d'avoir choisi Loc'Air !</p>
      <div class="box" style="text-align:center">
        <p style="margin:0 0 6px">Pour vous remercier, profitez de <strong>-${REFERRAL_PCT}%</strong> sur votre prochaine réservation avec le code</p>
        <p style="margin:0 0 6px;font-size:20px;font-weight:800;letter-spacing:.05em;color:#1b3a5f">${escHtml(code)}</p>
        <p style="margin:0;font-size:13px;color:#666">Offre valable aussi pour vos amis, avec leur prénom comme code (ex. -${REFERRAL_PCT}% avec le prénom de votre ami).</p>
      </div>
      <p style="font-size:13px;color:#444">Si vous avez une minute, votre avis aide d'autres familles à nous faire confiance :</p>`,
    ctaHref: 'https://g.page/r/CeJQrt2gLNNrEAE/review', ctaLabel: 'Laisser un avis Google ⭐',
  });
}

// Confirmation de prolongation
function tplProlongConfirmation({ prenom, nom, jours, date_recuperation, creneau, amount, lang }) {
  const l = lang || 'fr';
  const jNum = Number(jours) || 1;
  const p = escHtml(prenom || '');
  if (l === 'en') return wrap({
    title: '✅ Extension confirmed!',
    intro: `Thank you ${p}, your payment of ${escHtml(amount)} has been received.`,
    bodyHtml: `
      <p><strong>Name:</strong> ${p} ${escHtml(nom || '')}<br/>
      <strong>Extra days:</strong> ${jNum} day${jNum > 1 ? 's' : ''}<br/>
      <strong>New collection date:</strong> ${escHtml(date_recuperation || '—')}<br/>
      <strong>Time slot:</strong> ${escHtml(creneau || '—')}<br/>
      <strong>Amount paid:</strong> ${escHtml(amount)}</p>
      <p style="font-size:13px;color:#444">Our technician will contact you the day before collection to confirm the time slot.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'A question? WhatsApp',
  });
  if (l === 'zh') return wrap({
    title: '✅ 续租已确认！',
    intro: `感谢 ${p}，我们已收到您的付款 ${escHtml(amount)}。`,
    bodyHtml: `
      <p><strong>姓名：</strong>${p} ${escHtml(nom || '')}<br/>
      <strong>续租天数：</strong>${jNum} 天<br/>
      <strong>新取回日期：</strong>${escHtml(date_recuperation || '—')}<br/>
      <strong>时间段：</strong>${escHtml(creneau || '—')}<br/>
      <strong>支付金额：</strong>${escHtml(amount)}</p>
      <p style="font-size:13px;color:#444">我们的技术员将在取回前一天联系您确认具体时间。</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: '有疑问？WhatsApp',
  });
  return wrap({
    title: '✅ Prolongation confirmée !',
    intro: `Merci ${p}, votre paiement de ${escHtml(amount)} a bien été reçu.`,
    bodyHtml: `
      <p><strong>Client :</strong> ${p} ${escHtml(nom || '')}<br/>
      <strong>Jours supplémentaires :</strong> ${jNum} jour${jNum > 1 ? 's' : ''}<br/>
      <strong>Récupération le :</strong> ${escHtml(date_recuperation || '—')}<br/>
      <strong>Créneau :</strong> ${escHtml(creneau || '—')}<br/>
      <strong>Montant payé :</strong> ${escHtml(amount)}</p>
      <p style="font-size:13px;color:#444">Notre technicien vous contactera la veille de la récupération pour confirmer le créneau.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Une question ? WhatsApp',
  });
}

// Contrat + facture de location
function tplContratFacture({ prenom, ref, viewUrlDocuments, lang }) {
  const l = lang || 'fr';
  const p = escHtml(prenom || '');
  if (l === 'en') return wrap({
    title: "📄 Your Loc'Air documents",
    intro: `Booking ref ${escHtml(ref)}`,
    bodyHtml: `
      <p>Hello ${p},</p>
      <p>Thank you for your trust. Please find your rental agreement and invoice attached.</p>
      <div class="box"><p style="margin:0"><a href="${viewUrlDocuments || '#'}" style="color:#1b3a5f;font-weight:700">View my documents online →</a></p></div>
      <p style="font-size:13px;color:#888">Keep this email — your documents remain accessible via the link above.</p>
      <p style="font-size:13px;color:#444">We'll be in touch again by email as your delivery date approaches.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'A question? WhatsApp',
  });
  if (l === 'zh') return wrap({
    title: "📄 您的 Loc'Air 文件",
    intro: `订单编号 ${escHtml(ref)}`,
    bodyHtml: `
      <p>您好 ${p}，</p>
      <p>感谢您的信任。请查收本邮件附件中的租赁合同和发票。</p>
      <div class="box"><p style="margin:0"><a href="${viewUrlDocuments || '#'}" style="color:#1b3a5f;font-weight:700">在线查看我的文件 →</a></p></div>
      <p style="font-size:13px;color:#888">请保存此邮件——您的文件可随时通过上方链接访问。</p>
      <p style="font-size:13px;color:#444">随着送货日期临近，我们将再次通过邮件与您联系。</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: '有疑问？WhatsApp',
  });
  return wrap({
    title: '📄 Vos documents Loc\'Air',
    intro: `Dossier ${escHtml(ref)}`,
    bodyHtml: `
      <p>Bonjour ${p},</p>
      <p>Merci pour votre confiance. Vous trouverez ci-joint votre contrat de location ainsi que votre facture.</p>
      <div class="box"><p style="margin:0"><a href="${viewUrlDocuments || '#'}" style="color:#1b3a5f;font-weight:700">Consulter mes documents en ligne →</a></p></div>
      <p style="font-size:13px;color:#888">Conservez cet email : vos documents restent accessibles à tout moment via le lien ci-dessus.</p>
      <p style="font-size:13px;color:#444">Nous revenons vers vous par email à l'approche de votre livraison.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Une question ? WhatsApp',
  });
}

// Facture d'achat Offre Privilège (interne — FR uniquement)
function tplFactureVente({ prenom, ref, modeleClimatiseur, dateAchatFmt, montantFmt, viewUrlFacture }) {
  return wrap({
    title: '📄 Votre facture d\'achat',
    intro: `Merci ${escHtml(prenom || '')}, votre paiement de ${escHtml(montantFmt || '')} a bien été reçu !`,
    bodyHtml: `
      <p>Merci pour votre confiance et votre achat via l'Offre Privilège (dossier ${escHtml(ref)}). Voici le récapitulatif :</p>
      <div class="box">
        ${modeleClimatiseur ? `<p style="margin:0 0 6px"><strong>Climatiseur :</strong> ${escHtml(modeleClimatiseur)}</p>` : ''}
        <p style="margin:0 0 6px"><strong>Date d'achat :</strong> ${escHtml(dateAchatFmt || '')}</p>
        <p style="margin:0"><strong>Montant payé :</strong> ${escHtml(montantFmt || '')}</p>
      </div>
      <p>Vous trouverez votre facture ci-jointe — vous pouvez aussi la <a href="${viewUrlFacture || '#'}" style="color:#1b3a5f;font-weight:700">consulter en ligne</a>.</p>
      <p>Le climatiseur vous appartient désormais définitivement : aucune autre action n'est nécessaire de votre part. En cas de souci technique (garantie, SAV), notre équipe reste disponible via WhatsApp ci-dessous.</p>
      <p style="font-size:13px;color:#888">Conservez cet email : ce document reste accessible à tout moment via le lien ci-dessus.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Une question ? WhatsApp',
  });
}

// Credentials ambassadeur (interne — FR uniquement)
function tplAmbassadeurCredentials({ nom, lien, pin }) {
  return wrap({
    title: '🤝 Ton espace ambassadeur',
    intro: `Bonjour ${escHtml(nom)}`,
    bodyHtml: `
      <p>Voici ton lien d'affiliation — mets-le sur ton site pour que tes clients réservent directement chez Loc'Air :</p>
      <div class="box"><p style="margin:0;font-size:15px;font-weight:700;word-break:break-all"><a href="${lien}" style="color:#1b3a5f">${escHtml(lien)}</a></p></div>
      <p>Ton code personnel pour suivre tes gains sur ton espace ambassadeur :</p>
      <p style="font-size:28px;font-weight:800;letter-spacing:4px;text-align:center;color:#1b3a5f">${escHtml(pin)}</p>
      <p style="font-size:13px;color:#888">Si tu n'es pas à l'origine de cette demande, contacte-nous immédiatement.</p>`,
    ctaHref: 'https://www.locair.fr/partenaire', ctaLabel: 'Ouvrir mon espace ambassadeur',
  });
}

// "Code oublié" ambassadeur (interne — FR uniquement)
function tplNouveauCodeAmbassadeur({ nom, lien, pin }) {
  return wrap({
    title: '🔐 Ton nouveau code ambassadeur',
    intro: `Bonjour ${escHtml(nom)}`,
    bodyHtml: `
      <p>Voici ton nouveau code personnel pour te connecter sur ton espace ambassadeur Loc'Air :</p>
      <p style="font-size:28px;font-weight:800;letter-spacing:4px;text-align:center;color:#1b3a5f">${escHtml(pin)}</p>
      <p>Ton lien d'affiliation ne change pas :</p>
      <div class="box"><p style="margin:0;font-size:15px;font-weight:700;word-break:break-all"><a href="${lien}" style="color:#1b3a5f">${escHtml(lien)}</a></p></div>
      <p style="font-size:13px;color:#888">Ton ancien code ne fonctionne plus. Si tu n'es pas à l'origine de cette demande, contacte-nous immédiatement.</p>`,
    ctaHref: 'https://www.locair.fr/partenaire', ctaLabel: 'Ouvrir mon espace ambassadeur',
  });
}

// "Code oublié" transporteur (interne — FR uniquement)
function tplNouveauCodeTransporteur({ nom, pin }) {
  return wrap({
    title: '🔐 Ton nouveau code',
    intro: `Bonjour ${escHtml(nom)}`,
    bodyHtml: `
      <p>Voici ton nouveau code personnel pour te connecter sur l'espace transporteur Loc'Air :</p>
      <p style="font-size:28px;font-weight:800;letter-spacing:4px;text-align:center;color:#1b3a5f">${escHtml(pin)}</p>
      <p style="font-size:13px;color:#888">Ton ancien code ne fonctionne plus. Si tu n'es pas à l'origine de cette demande, contacte-nous immédiatement.</p>`,
    ctaHref: 'https://www.locair.fr/transporteur', ctaLabel: 'Ouvrir mon espace transporteur',
  });
}

module.exports = {
  escHtml, wrap,
  tplConfirmation, tplSuiviJ14, tplPreparationJ3, tplRappelJ1,
  tplPostInstallation, tplAvantFinLocation, tplRappelRecuperation, tplFinLocation,
  tplProlongConfirmation, tplContratFacture, tplFactureVente,
  tplAmbassadeurCredentials, tplNouveauCodeAmbassadeur, tplNouveauCodeTransporteur,
};
