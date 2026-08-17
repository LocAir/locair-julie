// Templates des scénarios email client — chaque fonction reçoit un ctx
// (déjà résolu par emailEngine.js) et retourne du HTML prêt à l'envoi.
// ctx.lang = 'fr' | 'en' | 'zh' | 'ru'  (défaut : 'fr')
const { promoCodeForPrenom, REFERRAL_PCT } = require('./promo');

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// reservations.installation est toujours stocké en français ("Technicien
// (80€)" / "Autonome (kit fourni)") — utilisé ailleurs dans le code comme
// valeur machine via .startsWith('Technicien') (checkout.js, pdf.js,
// transporteurNotif.js...), donc jamais traduit à la source. Cette fonction
// ne traduit que l'AFFICHAGE dans l'email, sans toucher à la valeur stockée
// ni à aucune de ces vérifications.
function installationLabel(lang, raw) {
  const isTech = String(raw || '').startsWith('Technicien');
  if (lang === 'en') return isTech ? 'Technician (€80)' : 'Self-install (kit provided)';
  if (lang === 'zh') return isTech ? '技术员安装（80€）' : '自行安装（提供工具包）';
  if (lang === 'ru') return isTech ? 'Мастер (80€)' : 'Самостоятельно (комплект предоставлен)';
  return raw || 'Autonome (kit fourni)';
}

// Habillage visuel unique (identité de marque) — même structure et mêmes
// paramètres qu'avant (headColor/title/intro/bodyHtml/ctaHref/ctaLabel).
//
// 2026-08-17 (demande d'Aly, capture d'écran à l'appui) : le bouton
// "Payer maintenant" s'affichait comme un simple lien bleu souligné,
// illisible sur le fond foncé — de nombreux clients mail (Outlook.com,
// Yahoo, certaines applis mobiles) ignorent purement et simplement la
// balise <style>, ou réappliquent leur propre couleur de lien par-dessus
// la classe .btn. Le bouton est donc reconstruit en "bulletproof button"
// (table + <a> entièrement stylé en ligne, bgcolor en attribut) : même
// sans aucun CSS, il reste un vrai bouton coloré avec un texte blanc
// lisible. Couleurs alignées sur l'identité de marque exacte du site
// (navy #1a2b4a, or #c5a96c — avant : #1b3a5f, un navy approchant mais pas
// identique). Wordmark "Loc'Air" ajouté en en-tête pour que chaque email
// soit immédiatement identifiable, même sans lire le sujet.
function wrap({ headColor = '#1a2b4a', title, intro, bodyHtml, ctaHref, ctaLabel }) {
  const preheader = intro ? String(intro).replace(/<[^>]+>/g, '').slice(0, 140) : '';
  const btnHtml = ctaHref ? `
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${ctaHref}" style="height:46px;v-text-anchor:middle;width:260px;" arcsize="50%" stroke="f" fillcolor="${headColor}">
    <w:anchorlock/>
    <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">${ctaLabel}</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px"><tr>
      <td align="center" bgcolor="${headColor}" style="border-radius:100px;background-color:${headColor}">
        <a href="${ctaHref}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:.01em;line-height:1;color:#ffffff!important;text-decoration:none!important;border-radius:100px;mso-hide:all">${ctaLabel}</a>
      </td>
    </tr></table>
    <!--<![endif]-->` : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#eee8dd;margin:0;padding:0;-webkit-font-smoothing:antialiased}
    .wrap{max-width:560px;margin:24px auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(26,43,74,.10)}
    .brand{color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:700;letter-spacing:-.01em;margin:0 0 16px}
    .brand em{font-style:italic;font-weight:400;color:#c5a96c}
    .head{background:${headColor};padding:30px 32px 30px;text-align:center}
    .head h1{color:#fff;font-size:21px;line-height:1.35;margin:0 0 8px;font-weight:700;letter-spacing:-.01em}
    .head p{color:rgba(255,255,255,.82);font-size:14px;margin:0;font-weight:500}
    .body{padding:32px 32px 30px;font-size:15px;color:#2b2b2e;line-height:1.65}
    .body p{margin:0 0 14px}
    .body p:last-child{margin-bottom:0}
    .box{background:#f7f3ea;border-left:3px solid ${headColor};border-radius:8px;padding:16px 20px;margin:18px 0}
    .box a{text-decoration:none}
    @media (max-width:480px){ .wrap{margin:0;border-radius:0} .head{padding:26px 22px 24px} .body{padding:24px 22px 26px} }
  </style></head><body>
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${preheader}</div>
  <div class="wrap">
    <div class="head"><p class="brand">Loc<em>'Air</em></p><h1>${title}</h1>${intro ? `<p>${intro}</p>` : ''}</div>
    <div class="body">${bodyHtml}${btnHtml}</div>
  </div></body></html>`;
}

// 1. Confirmation de réservation
function tplConfirmation(ctx) {
  const l = ctx.lang || 'fr';
  const p = escHtml(ctx.prenom), ref = escHtml(ctx.ref);
  if (l === 'en') return wrap({
    title: 'Booking confirmed!',
    intro: `Thank you ${p}, your payment of ${escHtml(ctx.montantFmt)} has been received.`,
    bodyHtml: `
      <div class="box"><p style="margin:0 0 4px;color:#888;font-size:12px">YOUR BOOKING</p><strong style="font-size:18px;color:#1b3a5f">${ref}</strong></div>
      <p><strong>Name:</strong> ${p} ${escHtml(ctx.nom)}<br/>
      <strong>Address:</strong> ${escHtml(ctx.adresse)}<br/>
      <strong>Delivery:</strong> ${escHtml(ctx.dateDebutFmt)}${ctx.creneau ? ' · ' + escHtml(ctx.creneau) : ''}<br/>
      <strong>Collection:</strong> ${escHtml(ctx.dateRecupFmt)}<br/>
      <strong>Unit:</strong> ${escHtml(ctx.modeleClimatiseur)}<br/>
      <strong>Installation:</strong> ${escHtml(installationLabel('en', ctx.installation))}<br/>
      <strong>Amount:</strong> ${escHtml(ctx.montantFmt)}</p>
      <p style="font-size:13px;color:#444">The technician will call you <strong>30 minutes before arriving</strong>.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'A question? WhatsApp',
  });
  if (l === 'zh') return wrap({
    title: '预订已确认！',
    intro: `感谢 ${p}，我们已收到您的付款 ${escHtml(ctx.montantFmt)}。`,
    bodyHtml: `
      <div class="box"><p style="margin:0 0 4px;color:#888;font-size:12px">您的订单</p><strong style="font-size:18px;color:#1b3a5f">${ref}</strong></div>
      <p><strong>姓名：</strong>${p} ${escHtml(ctx.nom)}<br/>
      <strong>地址：</strong>${escHtml(ctx.adresse)}<br/>
      <strong>配送日期：</strong>${escHtml(ctx.dateDebutFmt)}${ctx.creneau ? ' · ' + escHtml(ctx.creneau) : ''}<br/>
      <strong>取回日期：</strong>${escHtml(ctx.dateRecupFmt)}<br/>
      <strong>设备：</strong>${escHtml(ctx.modeleClimatiseur)}<br/>
      <strong>安装方式：</strong>${escHtml(installationLabel('zh', ctx.installation))}<br/>
      <strong>金额：</strong>${escHtml(ctx.montantFmt)}</p>
      <p style="font-size:13px;color:#444">技术员将在<strong>到达前30分钟</strong>致电通知您。</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: '有疑问？WhatsApp',
  });
  if (l === 'ru') return wrap({
    title: 'Бронирование подтверждено!',
    intro: `Спасибо, ${p}! Ваш платёж ${escHtml(ctx.montantFmt)} получен.`,
    bodyHtml: `
      <div class="box"><p style="margin:0 0 4px;color:#888;font-size:12px">ВАШ ЗАКАЗ</p><strong style="font-size:18px;color:#1b3a5f">${ref}</strong></div>
      <p><strong>Имя:</strong> ${p} ${escHtml(ctx.nom)}<br/>
      <strong>Адрес:</strong> ${escHtml(ctx.adresse)}<br/>
      <strong>Доставка:</strong> ${escHtml(ctx.dateDebutFmt)}${ctx.creneau ? ' · ' + escHtml(ctx.creneau) : ''}<br/>
      <strong>Возврат:</strong> ${escHtml(ctx.dateRecupFmt)}<br/>
      <strong>Устройство:</strong> ${escHtml(ctx.modeleClimatiseur)}<br/>
      <strong>Установка:</strong> ${escHtml(installationLabel('ru', ctx.installation))}<br/>
      <strong>Сумма:</strong> ${escHtml(ctx.montantFmt)}</p>
      <p style="font-size:13px;color:#444">Мастер позвонит вам <strong>за 30 минут до приезда</strong>.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Вопрос? WhatsApp',
  });
  return wrap({
    title: 'Réservation confirmée !',
    intro: `Merci ${p}, votre paiement de ${escHtml(ctx.montantFmt)} a bien été reçu.`,
    bodyHtml: `
      <div class="box"><p style="margin:0 0 4px;color:#888;font-size:12px">VOTRE DOSSIER</p><strong style="font-size:18px;color:#1b3a5f">${ref}</strong></div>
      <p><strong>Client :</strong> ${p} ${escHtml(ctx.nom)}<br/>
      <strong>Adresse :</strong> ${escHtml(ctx.adresse)}<br/>
      <strong>Livraison :</strong> ${escHtml(ctx.dateDebutFmt)}${ctx.creneau ? ' · ' + escHtml(ctx.creneau) : ''}<br/>
      <strong>Récupération :</strong> ${escHtml(ctx.dateRecupFmt)}<br/>
      <strong>Climatiseur :</strong> ${escHtml(ctx.modeleClimatiseur)}<br/>
      <strong>Installation :</strong> ${escHtml(installationLabel('fr', ctx.installation))}<br/>
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
    ctaHref: ctx.lienEspaceClient, ctaLabel: 'My account',
  });
  if (l === 'zh') return wrap({
    title: '您的空调将在14天后送达',
    intro: `订单编号 ${ref}`,
    bodyHtml: `
      <p>您好 ${p}，</p>
      <p>您的 Loc'Air 预订（订单 ${ref}）已确认，配送日期为 <strong>${escHtml(ctx.dateDebutFmt)}</strong>。</p>
      <p>目前无需任何操作——我们将在配送前几天联系您确认具体时间。</p>`,
    ctaHref: ctx.lienEspaceClient, ctaLabel: '我的账户',
  });
  if (l === 'ru') return wrap({
    title: 'Ваш кондиционер прибудет через 14 дней',
    intro: `Заказ ${ref}`,
    bodyHtml: `
      <p>Здравствуйте, ${p}!</p>
      <p>Ваш заказ Loc'Air (номер ${ref}) подтверждён на <strong>${escHtml(ctx.dateDebutFmt)}</strong>.</p>
      <p>Пока ничего делать не нужно — мы свяжемся с вами за несколько дней до доставки для уточнения времени.</p>`,
    ctaHref: ctx.lienEspaceClient, ctaLabel: 'Личный кабинет',
  });
  return wrap({
    title: 'Votre climatiseur arrive dans 14 jours',
    intro: `Dossier ${ref}`,
    bodyHtml: `
      <p>Bonjour ${p},</p>
      <p>Votre réservation Loc'Air (dossier ${ref}) est bien confirmée pour le <strong>${escHtml(ctx.dateDebutFmt)}</strong>.</p>
      <p>Rien à faire de votre côté pour l'instant — nous revenons vers vous quelques jours avant la livraison pour finaliser le créneau.</p>`,
    ctaHref: ctx.lienEspaceClient, ctaLabel: 'Mon espace client',
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
  if (l === 'ru') return wrap({
    title: 'Доставка совсем скоро',
    intro: `Заказ ${ref}`,
    bodyHtml: `
      <p>Здравствуйте, ${p}!</p>
      <p>Ваш кондиционер Loc'Air доставят <strong>${escHtml(ctx.dateDebutFmt)}</strong>${ctx.creneau ? ' (слот ' + escHtml(ctx.creneau) + ')' : ''} по адресу: ${escHtml(ctx.adresse)}.</p>
      <div class="box"><p style="margin:0">Пожалуйста, убедитесь, что вы (или кто-то из близких) будете дома и доступ к окну свободен.</p></div>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Изменить временной слот',
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
  if (l === 'ru') return wrap({
    title: 'Завтра — доставка вашего кондиционера!',
    intro: `Заказ ${ref}`,
    bodyHtml: `
      <p>Здравствуйте, ${p}!</p>
      <p>Ваш мобильный кондиционер Loc'Air будет доставлен <strong>завтра</strong>.</p>
      <div class="box">
        <p style="margin:0 0 6px"><strong>Адрес:</strong> ${escHtml(ctx.adresse)}</p>
        <p style="margin:0 0 6px"><strong>Временной слот:</strong> ${escHtml(ctx.creneau || 'уточним утром')}</p>
        <p style="margin:0"><strong>Мастер позвонит вам за 30 минут до приезда.</strong></p>
      </div>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Изменить временной слот',
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
    title: 'Your AC is installed!',
    intro: `Booking ref ${ref}`,
    bodyHtml: `
      <p>Hello ${p},</p>
      <p>Your ${escHtml(ctx.modeleClimatiseur)} is installed and ready to use.</p>
      <p>Any issue or question? Our team is reachable at any time.</p>
      <p style="font-size:13px;color:#888">If you have a minute, your review helps other families trust us:</p>`,
    ctaHref: 'https://g.page/r/CeJQrt2gLNNrEAE/review', ctaLabel: 'Leave a Google review',
  });
  if (l === 'zh') return wrap({
    title: '您的空调已安装！',
    intro: `订单编号 ${ref}`,
    bodyHtml: `
      <p>您好 ${p}，</p>
      <p>您的 ${escHtml(ctx.modeleClimatiseur)} 已安装完毕，可以使用。</p>
      <p>如有任何问题，请随时联系我们的团队。</p>
      <p style="font-size:13px;color:#888">如果您有时间，您的评价将帮助更多家庭了解我们：</p>`,
    ctaHref: 'https://g.page/r/CeJQrt2gLNNrEAE/review', ctaLabel: '留下 Google 评价',
  });
  if (l === 'ru') return wrap({
    title: 'Ваш кондиционер установлен!',
    intro: `Заказ ${ref}`,
    bodyHtml: `
      <p>Здравствуйте, ${p}!</p>
      <p>Ваш ${escHtml(ctx.modeleClimatiseur)} установлен и готов к работе.</p>
      <p>Есть вопросы или проблемы? Наша команда всегда на связи.</p>
      <p style="font-size:13px;color:#888">Если есть минутка, ваш отзыв поможет другим семьям нам доверять:</p>`,
    ctaHref: 'https://g.page/r/CeJQrt2gLNNrEAE/review', ctaLabel: 'Оставить отзыв в Google',
  });
  return wrap({
    title: 'Votre climatiseur est installé !',
    intro: `Dossier ${ref}`,
    bodyHtml: `
      <p>Bonjour ${p},</p>
      <p>Votre ${escHtml(ctx.modeleClimatiseur)} est installé et prêt à l'emploi.</p>
      <p>Un souci, une question ? Notre équipe reste joignable à tout moment — <a href="https://wa.me/33663798756" style="color:#1b3a5f;font-weight:700">WhatsApp</a> ou <a href="mailto:contact@locair.fr" style="color:#1b3a5f">contact@locair.fr</a>.</p>
      <p style="font-size:13px;color:#888">Si vous avez une minute dès maintenant, votre avis nous aide beaucoup :</p>`,
    ctaHref: 'https://g.page/r/CeJQrt2gLNNrEAE/review', ctaLabel: 'Laisser un avis Google',
  });
}

// 6. Avant fin de location (2 options : prolonger, ou choisir son créneau de
// récupération) — aligné sur le SMS sms_relance_prolongation (même sujet,
// envoyé quelques jours plus tôt, voir _lib/reservations.js) : avant ce
// correctif (audit du 2026-08-05), cet email ne proposait QUE de prolonger,
// vers une page à part (/prolongation) différente du lien du SMS — un
// client qui recevait les deux se retrouvait avec 2 messages incohérents
// sur le même sujet. Pointe maintenant vers l'espace client, qui propose
// réellement les deux (client/index.html + api/client-recup.js).
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
        <p style="margin:0 0 8px;font-weight:700;font-size:15px">From your client space, in a few clicks:</p>
        <p style="margin:0;color:#666">Extend your rental, or choose your collection time slot — booking ref ${escHtml(ctx.ref)}</p>
      </div>
      <p style="font-size:13px;color:#888">If you don't need to extend, our team will collect the unit on the scheduled date.</p>`,
    ctaHref: ctx.lienEspaceClient, ctaLabel: 'My client space',
  });
  if (l === 'zh') return wrap({
    title: '您的租赁即将结束',
    intro: `订单编号 ${ref}`,
    bodyHtml: `
      <p>您好 ${p}，</p>
      <p>您的空调将于 <strong>${escHtml(ctx.dateRecupFmt)}</strong> 取回。天气还是很热吗？</p>
      <div class="box" style="text-align:center">
        <p style="margin:0 0 8px;font-weight:700;font-size:15px">在您的客户空间，只需几步：</p>
        <p style="margin:0;color:#666">续租，或选择取回时间段 — 订单编号 ${escHtml(ctx.ref)}</p>
      </div>
      <p style="font-size:13px;color:#888">如不需要续租，我们的团队将按计划日期取回设备。</p>`,
    ctaHref: ctx.lienEspaceClient, ctaLabel: '我的客户空间',
  });
  if (l === 'ru') return wrap({
    title: 'Срок аренды скоро истекает',
    intro: `Заказ ${ref}`,
    bodyHtml: `
      <p>Здравствуйте, ${p}!</p>
      <p>Ваш кондиционер заберут <strong>${escHtml(ctx.dateRecupFmt)}</strong>. Всё ещё жарко?</p>
      <div class="box" style="text-align:center">
        <p style="margin:0 0 8px;font-weight:700;font-size:15px">В личном кабинете, в несколько кликов:</p>
        <p style="margin:0;color:#666">Продлите аренду или выберите время возврата — номер заказа ${escHtml(ctx.ref)}</p>
      </div>
      <p style="font-size:13px;color:#888">Если продление не нужно, наша команда заберёт устройство в запланированную дату.</p>`,
    ctaHref: ctx.lienEspaceClient, ctaLabel: 'Личный кабинет',
  });
  return wrap({
    title: 'Votre location se termine bientôt',
    intro: `Dossier ${ref}`,
    bodyHtml: `
      <p>Bonjour ${p},</p>
      <p>Votre climatiseur sera récupéré le <strong>${escHtml(ctx.dateRecupFmt)}</strong>. La chaleur est toujours là ?</p>
      <div class="box" style="text-align:center">
        <p style="margin:0 0 8px;font-weight:700;font-size:15px">Depuis votre espace client, en quelques clics :</p>
        <p style="margin:0;color:#666">Prolongez votre location, ou choisissez votre créneau de récupération — numéro de commande ${escHtml(ctx.ref)}</p>
      </div>
      <p style="font-size:13px;color:#888">Si vous n'avez pas besoin de prolonger, notre équipe récupérera l'appareil à la date prévue.</p>`,
    ctaHref: ctx.lienEspaceClient, ctaLabel: 'Mon espace client',
  });
}

// 7. Rappel récupération J-1
// Le 2e paragraphe de l'encart ("box") dépend de si le client a déjà choisi
// son créneau de récupération (client-recup.js, "avancer la récupération")
// ou si l'équipe doit encore le confirmer par téléphone — 2e correction
// d'Aly, 2026-08-05 : le rappel doit refléter le vrai choix du client. Plus
// de "Votre location se termine aujourd'hui (date_fin)" en intro : cette
// phrase n'est plus toujours vraie dès qu'une récupération a été avancée ou
// reprogrammée à une date différente de date_fin.
function tplRappelRecuperation(ctx) {
  const l = ctx.lang || 'fr';
  const p = escHtml(ctx.prenom), ref = escHtml(ctx.ref);
  const creneau = escHtml(ctx.creneauRecuperation || '');
  if (l === 'en') return wrap({
    title: 'AC collection tomorrow',
    intro: `Booking ref ${ref}`,
    bodyHtml: `
      <p>Hello ${p},</p>
      <p>Just a reminder: our technician will come to collect your Loc'Air unit tomorrow (<strong>${escHtml(ctx.dateRecupFmt)}</strong>).</p>
      <div class="box"><p style="margin:0 0 6px"><strong>Address:</strong> ${escHtml(ctx.adresse)}</p><p style="margin:0">${creneau ? `<strong>Time slot:</strong> ${creneau}` : 'We will call you in the morning to confirm the exact time slot.'}</p></div>
      <p>Please have the unit unplugged and the duct rolled up if possible.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Contact us',
  });
  if (l === 'zh') return wrap({
    title: '明天将取回您的空调',
    intro: `订单编号 ${ref}`,
    bodyHtml: `
      <p>您好 ${p}，</p>
      <p>提醒您：我们的技术员明天（<strong>${escHtml(ctx.dateRecupFmt)}</strong>）将前来取回您的Loc'Air设备。</p>
      <div class="box"><p style="margin:0 0 6px"><strong>地址：</strong>${escHtml(ctx.adresse)}</p><p style="margin:0">${creneau ? `<strong>时间段：</strong>${creneau}` : '我们将于当天早上来电确认具体时间。'}</p></div>
      <p>请提前拔掉电源，如可能请将排风管卷好。</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: '联系我们',
  });
  if (l === 'ru') return wrap({
    title: 'Завтра — возврат кондиционера',
    intro: `Заказ ${ref}`,
    bodyHtml: `
      <p>Здравствуйте, ${p}!</p>
      <p>Напоминаем: наш мастер заберёт ваш кондиционер Loc'Air завтра (<strong>${escHtml(ctx.dateRecupFmt)}</strong>).</p>
      <div class="box"><p style="margin:0 0 6px"><strong>Адрес:</strong> ${escHtml(ctx.adresse)}</p><p style="margin:0">${creneau ? `<strong>Время:</strong> ${creneau}` : 'Мы позвоним утром для уточнения времени.'}</p></div>
      <p>Пожалуйста, отключите устройство от розетки и по возможности скатайте гофру.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Связаться с нами',
  });
  return wrap({
    title: 'Récupération de votre climatiseur demain',
    intro: `Dossier ${ref}`,
    bodyHtml: `
      <p>Bonjour ${p},</p>
      <p>Petit rappel : notre technicien viendra récupérer votre climatiseur Loc'Air demain (<strong>${escHtml(ctx.dateRecupFmt)}</strong>).</p>
      <div class="box"><p style="margin:0 0 6px"><strong>Adresse :</strong> ${escHtml(ctx.adresse)}</p><p style="margin:0">${creneau ? `<strong>Créneau :</strong> ${creneau}` : 'Nous vous appellerons le matin pour confirmer le créneau.'}</p></div>
      <p>Merci de préparer l'appareil (débranché, gaine récupérée si possible).</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Nous contacter',
  });
}

// 8. Fin de location (remerciement + code fidélité + avis)
function tplFinLocation(ctx) {
  const l = ctx.lang || 'fr';
  const p = escHtml(ctx.prenom), ref = escHtml(ctx.ref);
  const code = ctx.prenom ? promoCodeForPrenom(ctx.prenom) : null;
  if (l === 'en') return wrap({
    title: 'Rental complete',
    intro: `Booking ref ${ref}`,
    bodyHtml: `
      <p>Hello ${p},</p>
      <p>Our technician has collected your AC. Thank you for choosing Loc'Air!</p>
      ${code ? `<div class="box" style="text-align:center">
        <p style="margin:0 0 6px">As a thank-you, enjoy <strong>${REFERRAL_PCT}% off</strong> your next booking with the code</p>
        <p style="margin:0 0 6px;font-size:20px;font-weight:800;letter-spacing:.05em;color:#1b3a5f">${escHtml(code)}</p>
        <p style="margin:0;font-size:13px;color:#666">You can also share it with friends — the code is their first name + 30 (e.g. JEAN30).</p>
      </div>` : ''}
      <p style="font-size:13px;color:#444">If you have a minute, your review helps other families trust us:</p>`,
    ctaHref: 'https://g.page/r/CeJQrt2gLNNrEAE/review', ctaLabel: 'Leave a Google review',
  });
  if (l === 'zh') return wrap({
    title: '租赁已完成',
    intro: `订单编号 ${ref}`,
    bodyHtml: `
      <p>您好 ${p}，</p>
      <p>我们的技术员已取回您的空调。感谢您选择 Loc'Air！</p>
      ${code ? `<div class="box" style="text-align:center">
        <p style="margin:0 0 6px">作为感谢，使用以下优惠码可享 <strong>-${REFERRAL_PCT}%</strong> 下次预订折扣</p>
        <p style="margin:0 0 6px;font-size:20px;font-weight:800;letter-spacing:.05em;color:#1b3a5f">${escHtml(code)}</p>
        <p style="margin:0;font-size:13px;color:#666">此优惠码也可与朋友分享——优惠码为朋友姓名加上30（例如：JEAN30）。</p>
      </div>` : ''}
      <p style="font-size:13px;color:#444">如有时间，您的评价将帮助更多家庭了解我们：</p>`,
    ctaHref: 'https://g.page/r/CeJQrt2gLNNrEAE/review', ctaLabel: '留下 Google 评价',
  });
  if (l === 'ru') return wrap({
    title: 'Аренда завершена',
    intro: `Заказ ${ref}`,
    bodyHtml: `
      <p>Здравствуйте, ${p}!</p>
      <p>Наш мастер забрал кондиционер. Спасибо, что выбрали Loc'Air!</p>
      ${code ? `<div class="box" style="text-align:center">
        <p style="margin:0 0 6px">В знак благодарности — <strong>скидка ${REFERRAL_PCT}%</strong> на следующую аренду по коду</p>
        <p style="margin:0 0 6px;font-size:20px;font-weight:800;letter-spacing:.05em;color:#1b3a5f">${escHtml(code)}</p>
        <p style="margin:0;font-size:13px;color:#666">Можете поделиться кодом с друзьями — их имя + 30 (например JEAN30).</p>
      </div>` : ''}
      <p style="font-size:13px;color:#444">Если есть минутка, ваш отзыв поможет другим семьям нам доверять:</p>`,
    ctaHref: 'https://g.page/r/CeJQrt2gLNNrEAE/review', ctaLabel: 'Оставить отзыв в Google',
  });
  return wrap({
    title: 'Location terminée',
    intro: `Dossier ${ref}`,
    bodyHtml: `
      <p>Bonjour ${p},</p>
      <p>Notre technicien a récupéré votre climatiseur. Merci d'avoir choisi Loc'Air !</p>
      ${code ? `<div class="box" style="text-align:center">
        <p style="margin:0 0 6px">Pour vous remercier, profitez de <strong>-${REFERRAL_PCT}%</strong> sur votre prochaine réservation avec le code</p>
        <p style="margin:0 0 6px;font-size:20px;font-weight:800;letter-spacing:.05em;color:#1b3a5f">${escHtml(code)}</p>
        <p style="margin:0;font-size:13px;color:#666">Offre valable aussi pour vos amis — le code, c'est leur prénom + ${REFERRAL_PCT} (ex. JEAN${REFERRAL_PCT}).</p>
      </div>` : ''}
      <p style="font-size:13px;color:#444">Si vous avez une minute, votre avis aide d'autres familles à nous faire confiance :</p>`,
    ctaHref: 'https://g.page/r/CeJQrt2gLNNrEAE/review', ctaLabel: 'Laisser un avis Google',
  });
}

// Confirmation de prolongation
// Le paramètre `ref` (identifiant technique interne MANUEL-xxx/PROLONG-xxx —
// voir isInternalRef côté admin/index.html) n'a jamais existé pour le client
// et ne doit jamais lui être montré : la seule référence qu'il connaît et
// dont il a besoin (espace client, appel au support) est celle de sa
// réservation d'origine, `ref_origine` — c'est elle qui pilote l'affichage.
// `creneau` : jamais fiable à la création d'une prolongation (aucun parcours
// client — page /prolongation ou espace client — ne fait choisir de créneau
// de récupération au moment de prolonger ; seul client-recup.js le permet,
// après coup). Avant le correctif du 2026-08-05 (audit), ce paramètre
// recevait par erreur le créneau de LIVRAISON de la réservation d'origine
// (copié dans admin-reservations.js/checkout-prolong.js), affiché ici comme
// si le client l'avait choisi pour SA récupération — jamais le cas. La
// ligne "Créneau" ne s'affiche donc que si une vraie valeur est fournie.
function tplProlongConfirmation({ ref_origine, prenom, nom, jours, date_recuperation, creneau, adresse, amount, lienEspaceClient, lang }) {
  const l = lang || 'fr';
  const jNum = Number(jours) || 1;
  const p = escHtml(prenom || '');
  const refBox = ref_origine ? `<div class="box"><p style="margin:0 0 4px;color:#888;font-size:12px">${l === 'en' ? 'BOOKING REF' : l === 'zh' ? '订单编号' : l === 'ru' ? 'НОМЕР ЗАКАЗА' : 'DOSSIER'}</p><strong style="font-size:18px;color:#1b3a5f">${escHtml(ref_origine)}</strong></div>` : '';
  const adresseRow = adresse ? `<strong>${l === 'en' ? 'Address' : l === 'zh' ? '地址' : l === 'ru' ? 'Адрес' : 'Adresse'} :</strong> ${escHtml(adresse)}<br/>` : '';
  const creneauRow = creneau
    ? `<strong>${l === 'en' ? 'Time slot' : l === 'zh' ? '时间段' : l === 'ru' ? 'Временной слот' : 'Créneau'} :</strong> ${escHtml(creneau)}<br/>`
    : '';
  if (l === 'en') return wrap({
    title: 'Extension confirmed!',
    intro: `Thank you ${p}, your payment of ${escHtml(amount)} has been received.`,
    bodyHtml: `
      ${refBox}
      <p><strong>Name:</strong> ${p} ${escHtml(nom || '')}<br/>
      ${adresseRow}<strong>Extra days:</strong> ${jNum} day${jNum > 1 ? 's' : ''}<br/>
      <strong>New collection date:</strong> ${escHtml(date_recuperation || '—')}<br/>
      ${creneauRow}<strong>Amount paid:</strong> ${escHtml(amount)}</p>
      <p style="font-size:13px;color:#444">Our technician will contact you the day before collection to confirm the time slot.</p>
      ${lienEspaceClient ? `<p style="font-size:13px;color:#444">You can view your updated rental dates at any time in <a href="${lienEspaceClient}" style="color:#1b3a5f;font-weight:700">your account</a>.</p>` : ''}`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'A question? WhatsApp',
  });
  if (l === 'zh') return wrap({
    title: '续租已确认！',
    intro: `感谢 ${p}，我们已收到您的付款 ${escHtml(amount)}。`,
    bodyHtml: `
      ${refBox}
      <p><strong>姓名：</strong>${p} ${escHtml(nom || '')}<br/>
      ${adresseRow}<strong>续租天数：</strong>${jNum} 天<br/>
      <strong>新取回日期：</strong>${escHtml(date_recuperation || '—')}<br/>
      ${creneauRow}<strong>支付金额：</strong>${escHtml(amount)}</p>
      <p style="font-size:13px;color:#444">我们的技术员将在取回前一天联系您确认具体时间。</p>
      ${lienEspaceClient ? `<p style="font-size:13px;color:#444">您可随时在<a href="${lienEspaceClient}" style="color:#1b3a5f;font-weight:700">我的账户</a>查看更新后的租赁日期。</p>` : ''}`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: '有疑问？WhatsApp',
  });
  if (l === 'ru') return wrap({
    title: 'Продление подтверждено!',
    intro: `Спасибо, ${p}! Ваш платёж ${escHtml(amount)} получен.`,
    bodyHtml: `
      ${refBox}
      <p><strong>Имя:</strong> ${p} ${escHtml(nom || '')}<br/>
      ${adresseRow}<strong>Дополнительные дни:</strong> ${jNum} ${jNum === 1 ? 'день' : jNum < 5 ? 'дня' : 'дней'}<br/>
      <strong>Новая дата возврата:</strong> ${escHtml(date_recuperation || '—')}<br/>
      ${creneauRow}<strong>Уплачено:</strong> ${escHtml(amount)}</p>
      <p style="font-size:13px;color:#444">Наш мастер свяжется с вами накануне возврата для подтверждения времени.</p>
      ${lienEspaceClient ? `<p style="font-size:13px;color:#444">Вы можете проверить обновлённые даты аренды в <a href="${lienEspaceClient}" style="color:#1b3a5f;font-weight:700">личном кабинете</a> в любое время.</p>` : ''}`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Вопрос? WhatsApp',
  });
  return wrap({
    title: 'Prolongation confirmée !',
    intro: `Merci ${p}, votre paiement de ${escHtml(amount)} a bien été reçu.`,
    bodyHtml: `
      ${refBox}
      <p><strong>Client :</strong> ${p} ${escHtml(nom || '')}<br/>
      ${adresseRow}<strong>Jours supplémentaires :</strong> ${jNum} jour${jNum > 1 ? 's' : ''}<br/>
      <strong>Récupération le :</strong> ${escHtml(date_recuperation || '—')}<br/>
      ${creneauRow}<strong>Montant payé :</strong> ${escHtml(amount)}</p>
      <p style="font-size:13px;color:#444">Notre technicien vous contactera la veille de la récupération pour confirmer le créneau.</p>
      ${lienEspaceClient ? `<p style="font-size:13px;color:#444">Vous pouvez consulter vos nouvelles dates à tout moment dans <a href="${lienEspaceClient}" style="color:#1b3a5f;font-weight:700">votre espace client</a>.</p>` : ''}`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Une question ? WhatsApp',
  });
}

// Contrat + facture de location
function tplContratFacture({ prenom, ref, viewUrlDocuments, lang }) {
  const l = lang || 'fr';
  const p = escHtml(prenom || '');
  if (l === 'en') return wrap({
    title: "Your Loc'Air documents",
    intro: `Booking ref ${escHtml(ref)}`,
    bodyHtml: `
      <p>Hello ${p},</p>
      <p>Thank you for your trust. Your <strong>rental agreement</strong> and <strong>invoice</strong> are now available online.</p>
      <div class="box">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.09em;color:#9aa0ab;text-transform:uppercase">Your documents</p>
        <a href="${viewUrlDocuments || '#'}" style="color:#1b3a5f;font-weight:700;font-size:15px;text-decoration:none">View my documents online →</a>
        <p style="margin:8px 0 0;font-size:12px;color:#9aa0ab">Rental agreement &nbsp;·&nbsp; Invoice (PDF)</p>
      </div>
      <p style="font-size:13px;color:#666">This link is permanent — your documents are accessible at any time.</p>
      <p style="font-size:13px;color:#666">We'll contact you before your delivery to confirm the time slot.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'A question? WhatsApp',
  });
  if (l === 'zh') return wrap({
    title: "您的 Loc'Air 文件",
    intro: `订单编号 ${escHtml(ref)}`,
    bodyHtml: `
      <p>您好 ${p}，</p>
      <p>感谢您的信任。您的<strong>租赁合同</strong>和<strong>发票</strong>现已可在线查看。</p>
      <div class="box">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.09em;color:#9aa0ab;text-transform:uppercase">您的文件</p>
        <a href="${viewUrlDocuments || '#'}" style="color:#1b3a5f;font-weight:700;font-size:15px;text-decoration:none">在线查看我的文件 →</a>
        <p style="margin:8px 0 0;font-size:12px;color:#9aa0ab">租赁合同 &nbsp;·&nbsp; 发票（PDF）</p>
      </div>
      <p style="font-size:13px;color:#666">此链接为永久链接——您的文件随时可访问。</p>
      <p style="font-size:13px;color:#666">我们将在配送前与您联系确认时间段。</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: '有疑问？WhatsApp',
  });
  if (l === 'ru') return wrap({
    title: "Ваши документы Loc'Air",
    intro: `Заказ ${escHtml(ref)}`,
    bodyHtml: `
      <p>Здравствуйте, ${p}!</p>
      <p>Спасибо за доверие. Ваш <strong>договор аренды</strong> и <strong>счёт</strong> доступны онлайн.</p>
      <div class="box">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.09em;color:#9aa0ab;text-transform:uppercase">Ваши документы</p>
        <a href="${viewUrlDocuments || '#'}" style="color:#1b3a5f;font-weight:700;font-size:15px;text-decoration:none">Просмотреть документы онлайн →</a>
        <p style="margin:8px 0 0;font-size:12px;color:#9aa0ab">Договор аренды &nbsp;·&nbsp; Счёт (PDF)</p>
      </div>
      <p style="font-size:13px;color:#666">Ссылка постоянная — ваши документы доступны в любое время.</p>
      <p style="font-size:13px;color:#666">Мы свяжемся с вами перед доставкой для подтверждения временного окна.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Вопрос? WhatsApp',
  });
  return wrap({
    title: 'Vos documents Loc\'Air',
    intro: `Dossier ${escHtml(ref)}`,
    bodyHtml: `
      <p>Bonjour ${p},</p>
      <p>Merci pour votre confiance. Votre <strong>contrat de location</strong> et votre <strong>facture</strong> sont disponibles en ligne.</p>
      <div class="box">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.09em;color:#9aa0ab;text-transform:uppercase">Vos documents</p>
        <a href="${viewUrlDocuments || '#'}" style="color:#1b3a5f;font-weight:700;font-size:15px;text-decoration:none">Consulter mes documents en ligne →</a>
        <p style="margin:8px 0 0;font-size:12px;color:#9aa0ab">Contrat de location &nbsp;·&nbsp; Facture (PDF)</p>
      </div>
      <p style="font-size:13px;color:#666">Ce lien est permanent — vos documents restent accessibles à tout moment.</p>
      <p style="font-size:13px;color:#666">Nous vous recontactons avant votre livraison pour confirmer le créneau.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Une question ? WhatsApp',
  });
}

// Contrat mis à jour + facture de prolongation — envoyé après une prolongation
// payée, en plus (jamais à la place) de l'email de confirmation de
// prolongation. Le client a déjà reçu un contrat + une facture à sa réservation
// initiale (tplContratFacture ci-dessus) ; ce texte précise explicitement que
// ce sont de NOUVEAUX documents mis à jour suite à l'extension, pour éviter
// toute confusion avec un doublon de l'envoi initial.
function tplContratFactureProlongation({ prenom, ref, viewUrlDocuments, lang }) {
  const l = lang || 'fr';
  const p = escHtml(prenom || '');
  if (l === 'en') return wrap({
    title: "Your Loc'Air prolongation amendment",
    intro: `Booking ref ${escHtml(ref)}`,
    bodyHtml: `
      <p>Hello ${p},</p>
      <p>Following your rental extension, an <strong>amendment</strong> to your rental agreement (documenting your new end date) and the <strong>invoice</strong> for your extension are now available online.</p>
      <div class="box">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.09em;color:#9aa0ab;text-transform:uppercase">Your documents</p>
        <a href="${viewUrlDocuments || '#'}" style="color:#1b3a5f;font-weight:700;font-size:15px;text-decoration:none">View my documents online →</a>
        <p style="margin:8px 0 0;font-size:12px;color:#9aa0ab">Prolongation amendment &nbsp;·&nbsp; Extension invoice (PDF)</p>
      </div>
      <p style="font-size:13px;color:#666">This link is permanent — your documents are accessible at any time.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'A question? WhatsApp',
  });
  if (l === 'zh') return wrap({
    title: "您的 Loc'Air 续租合同附加协议",
    intro: `订单编号 ${escHtml(ref)}`,
    bodyHtml: `
      <p>您好 ${p}，</p>
      <p>由于您延长了租期，记录您新结束日期的<strong>合同附加协议</strong>及续租<strong>发票</strong>现已可在线查看。</p>
      <div class="box">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.09em;color:#9aa0ab;text-transform:uppercase">您的文件</p>
        <a href="${viewUrlDocuments || '#'}" style="color:#1b3a5f;font-weight:700;font-size:15px;text-decoration:none">在线查看我的文件 →</a>
        <p style="margin:8px 0 0;font-size:12px;color:#9aa0ab">续租合同附加协议 &nbsp;·&nbsp; 续租发票（PDF）</p>
      </div>
      <p style="font-size:13px;color:#666">此链接为永久链接——您的文件随时可访问。</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: '有疑问？WhatsApp',
  });
  if (l === 'ru') return wrap({
    title: "Ваш акт о продлении Loc'Air",
    intro: `Заказ ${escHtml(ref)}`,
    bodyHtml: `
      <p>Здравствуйте, ${p}!</p>
      <p>После продления вашей аренды <strong>дополнительное соглашение</strong> к договору аренды (с новой датой окончания) и <strong>счёт</strong> за продление теперь доступны онлайн.</p>
      <div class="box">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.09em;color:#9aa0ab;text-transform:uppercase">Ваши документы</p>
        <a href="${viewUrlDocuments || '#'}" style="color:#1b3a5f;font-weight:700;font-size:15px;text-decoration:none">Просмотреть документы онлайн →</a>
        <p style="margin:8px 0 0;font-size:12px;color:#9aa0ab">Дополнительное соглашение о продлении &nbsp;·&nbsp; Счёт за продление (PDF)</p>
      </div>
      <p style="font-size:13px;color:#666">Ссылка постоянная — ваши документы доступны в любое время.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Вопрос? WhatsApp',
  });
  return wrap({
    title: 'Votre avenant de prolongation Loc\'Air',
    intro: `Dossier ${escHtml(ref)}`,
    bodyHtml: `
      <p>Bonjour ${p},</p>
      <p>Suite à votre prolongation, l'<strong>avenant</strong> qui modifie la date de fin de votre contrat de location et la <strong>facture</strong> de votre prolongation sont disponibles en ligne.</p>
      <div class="box">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.09em;color:#9aa0ab;text-transform:uppercase">Vos documents</p>
        <a href="${viewUrlDocuments || '#'}" style="color:#1b3a5f;font-weight:700;font-size:15px;text-decoration:none">Consulter mes documents en ligne →</a>
        <p style="margin:8px 0 0;font-size:12px;color:#9aa0ab">Avenant de prolongation &nbsp;·&nbsp; Facture de prolongation (PDF)</p>
      </div>
      <p style="font-size:13px;color:#666">Ce lien est permanent — vos documents restent accessibles à tout moment.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Une question ? WhatsApp',
  });
}

// Facture d'achat Offre Privilège — corrige un oubli trouvé lors de l'audit
// du 2026-08-05 : le champ `lang` était bien calculé et transmis par
// generateAndSendFactureVente (_lib/documents.js, sujet de l'email déjà
// traduit), mais silencieusement ignoré ici — un client anglophone/sinophone
// recevait un sujet dans sa langue puis un corps de mail entièrement en
// français. Même structure que tplContratFacture ci-dessus.
function tplFactureVente({ prenom, ref, modeleClimatiseur, dateAchatFmt, montantFmt, viewUrlFacture, lang }) {
  const l = lang || 'fr';
  const p = escHtml(prenom || '');
  if (l === 'en') return wrap({
    title: 'Your purchase invoice',
    intro: `Thank you ${p}, your payment of ${escHtml(montantFmt || '')} has been received!`,
    bodyHtml: `
      <p>Thank you for your trust and for your purchase via the Offre Privilège (booking ref ${escHtml(ref)}). Here is your summary:</p>
      <div class="box">
        ${modeleClimatiseur ? `<p style="margin:0 0 6px"><strong>Air conditioner:</strong> ${escHtml(modeleClimatiseur)}</p>` : ''}
        <p style="margin:0 0 6px"><strong>Purchase date:</strong> ${escHtml(dateAchatFmt || '')}</p>
        <p style="margin:0"><strong>Amount paid:</strong> ${escHtml(montantFmt || '')}</p>
      </div>
      <p>You'll find your invoice attached — you can also <a href="${viewUrlFacture || '#'}" style="color:#1b3a5f;font-weight:700">view it online</a>.</p>
      <p>The air conditioner is now yours to keep for good: no further action is needed on your part. For any technical issue (warranty, repair), our team remains available via WhatsApp below.</p>
      <p style="font-size:13px;color:#888">Keep this email: this document stays accessible at any time via the link above.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'A question? WhatsApp',
  });
  if (l === 'zh') return wrap({
    title: '您的购买发票',
    intro: `谢谢您，${p}，我们已收到您 ${escHtml(montantFmt || '')} 的付款！`,
    bodyHtml: `
      <p>感谢您的信任，感谢您通过 Offre Privilège 购买（订单 ${escHtml(ref)}）。以下是摘要：</p>
      <div class="box">
        ${modeleClimatiseur ? `<p style="margin:0 0 6px"><strong>空调：</strong> ${escHtml(modeleClimatiseur)}</p>` : ''}
        <p style="margin:0 0 6px"><strong>购买日期：</strong> ${escHtml(dateAchatFmt || '')}</p>
        <p style="margin:0"><strong>已付金额：</strong> ${escHtml(montantFmt || '')}</p>
      </div>
      <p>您的发票已作为附件发送——您也可以<a href="${viewUrlFacture || '#'}" style="color:#1b3a5f;font-weight:700">在线查看</a>。</p>
      <p>该空调现已完全归您所有，无需任何其他操作。如有技术问题（保修、维修），我们的团队仍可通过下方的 WhatsApp 为您服务。</p>
      <p style="font-size:13px;color:#888">请保留此邮件：该文件可通过上方链接随时查看。</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: '有疑问？WhatsApp',
  });
  if (l === 'ru') return wrap({
    title: 'Ваш счёт на покупку',
    intro: `Спасибо, ${p}! Ваш платёж на сумму ${escHtml(montantFmt || '')} получен!`,
    bodyHtml: `
      <p>Спасибо за доверие и за покупку по программе Offre Privilège (заказ ${escHtml(ref)}). Вот сводка:</p>
      <div class="box">
        ${modeleClimatiseur ? `<p style="margin:0 0 6px"><strong>Кондиционер:</strong> ${escHtml(modeleClimatiseur)}</p>` : ''}
        <p style="margin:0 0 6px"><strong>Дата покупки:</strong> ${escHtml(dateAchatFmt || '')}</p>
        <p style="margin:0"><strong>Оплаченная сумма:</strong> ${escHtml(montantFmt || '')}</p>
      </div>
      <p>Счёт приложен к письму — вы также можете <a href="${viewUrlFacture || '#'}" style="color:#1b3a5f;font-weight:700">посмотреть его онлайн</a>.</p>
      <p>Кондиционер теперь окончательно принадлежит вам: никаких дальнейших действий не требуется. При технической проблеме (гарантия, ремонт) наша команда остаётся на связи через WhatsApp ниже.</p>
      <p style="font-size:13px;color:#888">Сохраните это письмо: документ остаётся доступным в любой момент по ссылке выше.</p>`,
    ctaHref: 'https://wa.me/33663798756', ctaLabel: 'Вопрос? WhatsApp',
  });
  return wrap({
    title: 'Votre facture d\'achat',
    intro: `Merci ${p}, votre paiement de ${escHtml(montantFmt || '')} a bien été reçu !`,
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
    title: 'Ton espace ambassadeur',
    intro: `Bonjour ${escHtml(nom)}`,
    bodyHtml: `
      <p>Voici ton lien d'affiliation — mets-le sur ton site pour que tes clients réservent directement chez Loc'Air :</p>
      <div class="box"><p style="margin:0;font-size:15px;font-weight:700;word-break:break-all"><a href="${escHtml(lien)}" style="color:#1b3a5f">${escHtml(lien)}</a></p></div>
      <p>Ton code personnel pour suivre tes gains sur ton espace ambassadeur :</p>
      <p style="font-size:28px;font-weight:800;letter-spacing:4px;text-align:center;color:#1b3a5f">${escHtml(pin)}</p>
      <p style="font-size:13px;color:#888">Si tu n'es pas à l'origine de cette demande, contacte-nous immédiatement.</p>`,
    ctaHref: 'https://www.locair.fr/partenaire', ctaLabel: 'Ouvrir mon espace ambassadeur',
  });
}

// "Code oublié" ambassadeur (interne — FR uniquement)
function tplNouveauCodeAmbassadeur({ nom, lien, pin }) {
  return wrap({
    title: 'Ton nouveau code ambassadeur',
    intro: `Bonjour ${escHtml(nom)}`,
    bodyHtml: `
      <p>Voici ton nouveau code personnel pour te connecter sur ton espace ambassadeur Loc'Air :</p>
      <p style="font-size:28px;font-weight:800;letter-spacing:4px;text-align:center;color:#1b3a5f">${escHtml(pin)}</p>
      <p>Ton lien d'affiliation ne change pas :</p>
      <div class="box"><p style="margin:0;font-size:15px;font-weight:700;word-break:break-all"><a href="${escHtml(lien)}" style="color:#1b3a5f">${escHtml(lien)}</a></p></div>
      <p style="font-size:13px;color:#888">Ton ancien code ne fonctionne plus. Si tu n'es pas à l'origine de cette demande, contacte-nous immédiatement.</p>`,
    ctaHref: 'https://www.locair.fr/partenaire', ctaLabel: 'Ouvrir mon espace ambassadeur',
  });
}

// "Code oublié" transporteur (interne — FR uniquement)
function tplNouveauCodeTransporteur({ nom, pin }) {
  return wrap({
    title: 'Ton nouveau code',
    intro: `Bonjour ${escHtml(nom)}`,
    bodyHtml: `
      <p>Voici ton nouveau code personnel pour te connecter sur l'espace transporteur Loc'Air :</p>
      <p style="font-size:28px;font-weight:800;letter-spacing:4px;text-align:center;color:#1b3a5f">${escHtml(pin)}</p>
      <p style="font-size:13px;color:#888">Ton ancien code ne fonctionne plus. Si tu n'es pas à l'origine de cette demande, contacte-nous immédiatement.</p>`,
    ctaHref: 'https://www.locair.fr/transporteur', ctaLabel: 'Ouvrir mon espace transporteur',
  });
}

// Lien de paiement Stripe pour une réservation prise par téléphone et encore
// "en attente" (interne — FR uniquement, même principe que tplContratFacture/
// tplFactureVente). Une fois payé, le webhook Stripe déclenche exactement le
// même circuit qu'un paiement fait sur le site (missions, documents, email
// de confirmation) — d'où le rappel que l'espace client fonctionne déjà avec
// juste l'email et le numéro de dossier ci-dessous, sans mot de passe.
function tplLienPaiement({ prenom, ref, adresse, dateDebutFmt, dateFinFmt, montantFmt, lienPaiement, breakdown, rappel, isProlongation, lang }) {
  const l = lang || 'fr';
  const p = escHtml(prenom || '');
  // Même détail que le récapitulatif de commande du site (#recap-box dans
  // index.html) : location / installation / livraison, plutôt qu'un seul
  // montant global — pour que le client retrouve les mêmes repères. Jamais
  // de décomposition pour une prolongation (pas de livraison/installation).
  const breakdownHtml = (breakdown && breakdown.length) ? `
      <div class="box">
        ${breakdown.map(r => `<div style="display:flex;justify-content:space-between;font-size:13px;color:#555;margin-bottom:6px"><span>${escHtml(r.label)}</span><span>${escHtml(r.value)}</span></div>`).join('')}
        <div style="display:flex;justify-content:space-between;margin-top:10px;padding-top:10px;border-top:1px solid rgba(27,58,95,.15);font-weight:700;color:#1b3a5f"><span>${l === 'en' ? 'Total due' : l === 'zh' ? '应付总额' : l === 'ru' ? 'Итого к оплате' : 'Total à régler'}</span><span>${escHtml(montantFmt)}</span></div>
      </div>` : `<div class="box"><p style="margin:0"><strong>${l === 'en' ? 'Amount due' : l === 'zh' ? '应付金额' : l === 'ru' ? 'Сумма к оплате' : 'Montant à régler'} :</strong> ${escHtml(montantFmt || '')}</p></div>`;
  // Une prolongation n'a ni nouvelle adresse ni nouvelle livraison — montrer
  // "Livraison"/"Récupération" comme pour une réservation neuve n'aurait pas
  // de sens (dateDebutFmt vaut ici l'ancienne date de fin de la location,
  // pas une date de livraison réelle) : on affiche juste la nouvelle date de
  // fin demandée par le client.
  const datesHtml = isProlongation
    ? `<p><strong>${l === 'en' ? 'New end date' : l === 'zh' ? '新结束日期' : l === 'ru' ? 'Новая дата окончания' : 'Nouvelle date de fin de location'} :</strong> ${escHtml(dateFinFmt || '')}</p>`
    : `<p><strong>${l === 'en' ? 'Address' : l === 'zh' ? '地址' : l === 'ru' ? 'Адрес' : 'Adresse'} :</strong> ${escHtml(adresse || '')}<br/>
      <strong>${l === 'en' ? 'Delivery' : l === 'zh' ? '配送日期' : l === 'ru' ? 'Доставка' : 'Livraison'} :</strong> ${escHtml(dateDebutFmt || '')}<br/>
      <strong>${l === 'en' ? 'Collection' : l === 'zh' ? '取回日期' : l === 'ru' ? 'Возврат' : 'Récupération'} :</strong> ${escHtml(dateFinFmt || '')}</p>`;
  const dossierLabel = l === 'en' ? 'YOUR BOOKING' : l === 'zh' ? '您的订单' : l === 'ru' ? 'ВАШ ЗАКАЗ' : 'VOTRE DOSSIER';
  // rappel=true : relance automatique (cron-daily.js) d'une réservation
  // restée en_attente trop longtemps — même contenu, ton différent (on ne
  // redit pas "votre réservation est prête" à un client qui l'a déjà vu).
  const bodyHtml = `
      <div class="box"><p style="margin:0 0 4px;color:#888;font-size:12px">${dossierLabel}</p><strong style="font-size:18px;color:#1b3a5f">${escHtml(ref)}</strong></div>
      ${datesHtml}
      ${breakdownHtml}
      <p>${l === 'en' ? 'Click the button below to pay securely online (payment processed by Stripe).' : l === 'zh' ? '点击下方按钮在线安全付款（由 Stripe 处理）。' : l === 'ru' ? 'Нажмите кнопку ниже для безопасной онлайн-оплаты (через Stripe).' : 'Cliquez sur le bouton ci-dessous pour payer en ligne, en toute sécurité (paiement géré par Stripe).'}</p>
      <p style="font-size:13px;color:#444">${l === 'en' ? "Once payment is received, you'll get a confirmation email. You can then track your rental at any time in <strong>your account</strong> using just your email and booking ref above — no password needed." : l === 'zh' ? '付款成功后，您将收到确认邮件。您可随时在<strong>您的账户</strong>中使用邮箱和上方订单编号查看租赁状态，无需密码。' : l === 'ru' ? 'После получения оплаты вы получите письмо с подтверждением. Вы сможете отслеживать аренду в любое время в <strong>личном кабинете</strong>, используя только ваш email и номер заказа выше — без пароля.' : 'Une fois le paiement reçu, vous recevrez un email de confirmation. Vous pourrez alors suivre votre location à tout moment sur <strong>votre espace client</strong>, avec juste votre email et le numéro de dossier ci-dessus — pas besoin de mot de passe.'}</p>`;
  if (l === 'en') return wrap({
    title: isProlongation ? 'A payment is still pending' : rappel ? 'A payment is still pending' : 'Complete your booking',
    intro: isProlongation
      ? `Hello ${p}, a reminder: your Loc'Air extension is still awaiting payment.`
      : rappel
      ? `Hello ${p}, a reminder: your Loc'Air booking is still awaiting payment.`
      : `Hello ${p}, your booking is ready — just the payment left to complete.`,
    bodyHtml,
    ctaHref: lienPaiement,
    ctaLabel: 'Pay now →',
  });
  if (l === 'zh') return wrap({
    title: isProlongation ? '仍有待完成的付款' : rappel ? '仍有待完成的付款' : '完成您的预订',
    intro: isProlongation
      ? `您好 ${p}，提醒您：您的 Loc'Air 续租申请仍等待付款。`
      : rappel
      ? `您好 ${p}，提醒您：您的 Loc'Air 预订仍等待付款。`
      : `您好 ${p}，您的预订已就绪——只需完成付款即可。`,
    bodyHtml,
    ctaHref: lienPaiement,
    ctaLabel: '立即付款 →',
  });
  if (l === 'ru') return wrap({
    title: isProlongation ? 'Ожидается оплата' : rappel ? 'Ожидается оплата' : 'Завершите бронирование',
    intro: isProlongation
      ? `Здравствуйте, ${p}! Напоминаем: ваше продление аренды Loc'Air ожидает оплаты.`
      : rappel
      ? `Здравствуйте, ${p}! Напоминаем: ваша аренда Loc'Air ожидает оплаты.`
      : `Здравствуйте, ${p}! Ваша заявка готова — осталось только оплатить.`,
    bodyHtml,
    ctaHref: lienPaiement,
    ctaLabel: 'Оплатить →',
  });
  return wrap({
    title: isProlongation ? 'Il reste un paiement à finaliser' : rappel ? 'Il reste un paiement à finaliser' : 'Finalisez votre réservation',
    intro: isProlongation
      ? `Bonjour ${p}, petit rappel : votre demande de prolongation Loc'Air est toujours en attente de paiement.`
      : rappel
      ? `Bonjour ${p}, petit rappel : votre réservation Loc'Air est toujours en attente de paiement.`
      : `Bonjour ${p}, votre réservation est prête — il ne reste que le paiement à finaliser.`,
    bodyHtml,
    ctaHref: lienPaiement,
    ctaLabel: 'Payer maintenant →',
  });
}

// Notification d'Offre Privilège au client — envoyée automatiquement par
// cron-daily.js dès qu'un prix auto est configuré (OFFRE_PRIVILEGE_PRIX_CENTS).
// Dirige le client vers son espace client pour accepter ou ignorer l'offre.
function tplOffrePrivilege({ prenom, ref, prixFormate, appareilNumero, lang }) {
  const l = lang || 'fr';
  const p = escHtml(prenom || '');
  const prix = escHtml(prixFormate || '');
  const r = escHtml(ref || '');
  if (l === 'en') {
    const appareil = appareilNumero ? `air conditioner #${escHtml(String(appareilNumero))}` : 'your air conditioner';
    return wrap({
      title: '⭐ An exclusive offer for you',
      intro: `Order ${r}`,
      bodyHtml: `
        <p>Hello ${p},</p>
        <p>Did you enjoy your air conditioner? We'd like to offer you the chance to <strong>keep it permanently</strong>, at the exceptional price of <strong>${prix}</strong>.</p>
        <div class="box">
          <p style="margin:0 0 4px;color:#888;font-size:12px">EXCLUSIVE OFFER</p>
          <p style="margin:0;font-size:17px;font-weight:700;color:#1a2b4a">Buy your ${appareil} — ${prix}</p>
          <p style="margin:6px 0 0;font-size:13px;color:#666">Final price, no extra fees. The unit is yours.</p>
        </div>
        <p>To accept or decline this offer, visit your client portal with your order number (<strong>${r}</strong>).</p>
        <p style="font-size:13px;color:#888">This offer is valid until the end of your rental. If you do nothing, the unit will be collected normally on the scheduled date — no action required.</p>`,
      ctaHref: 'https://www.locair.fr/client',
      ctaLabel: 'View the offer in my account →',
    });
  }
  if (l === 'zh') {
    const appareil = appareilNumero ? `空调 #${escHtml(String(appareilNumero))}` : '您的空调';
    return wrap({
      title: '⭐ 专属优惠，为您而设',
      intro: `订单 ${r}`,
      bodyHtml: `
        <p>您好，${p}，</p>
        <p>您喜欢这台空调吗？我们为您提供以优惠价 <strong>${prix}</strong> <strong>永久保留</strong>它的机会。</p>
        <div class="box">
          <p style="margin:0 0 4px;color:#888;font-size:12px">专属优惠</p>
          <p style="margin:0;font-size:17px;font-weight:700;color:#1a2b4a">购买您的${appareil} — ${prix}</p>
          <p style="margin:6px 0 0;font-size:13px;color:#666">最终价格，无附加费用，空调归您所有。</p>
        </div>
        <p>如需接受或拒绝此优惠，请使用您的订单号（<strong>${r}</strong>）登录您的客户空间。</p>
        <p style="font-size:13px;color:#888">该优惠在您的租赁期结束前有效。如果您不采取任何操作，空调将在预定日期正常回收——无需任何操作。</p>`,
      ctaHref: 'https://www.locair.fr/client',
      ctaLabel: '查看我的优惠 →',
    });
  }
  if (l === 'ru') {
    const appareil = appareilNumero ? `кондиционер #${escHtml(String(appareilNumero))}` : 'ваш кондиционер';
    return wrap({
      title: '⭐ Эксклюзивное предложение для вас',
      intro: `Заказ ${r}`,
      bodyHtml: `
        <p>Здравствуйте, ${p}!</p>
        <p>Остались довольны кондиционером? Предлагаем вам <strong>оставить его навсегда</strong> по исключительной цене <strong>${prix}</strong>.</p>
        <div class="box">
          <p style="margin:0 0 4px;color:#888;font-size:12px">ПРИВИЛЕГИРОВАННОЕ ПРЕДЛОЖЕНИЕ</p>
          <p style="margin:0;font-size:17px;font-weight:700;color:#1a2b4a">Купите ${appareil} — ${prix}</p>
          <p style="margin:6px 0 0;font-size:13px;color:#666">Окончательная цена, без дополнительных расходов. Прибор будет вашим.</p>
        </div>
        <p>Чтобы принять или отклонить предложение, зайдите в личный кабинет с номером заказа (<strong>${r}</strong>).</p>
        <p style="font-size:13px;color:#888">Предложение действительно до окончания аренды. Если вы ничего не предпримете, прибор будет забран в плановую дату — никаких действий не требуется.</p>`,
      ctaHref: 'https://www.locair.fr/client',
      ctaLabel: 'Посмотреть предложение →',
    });
  }
  const appareil = appareilNumero ? `climatiseur #${escHtml(String(appareilNumero))}` : 'votre climatiseur';
  return wrap({
    title: '⭐ Une offre exclusive pour vous',
    intro: `Dossier ${r}`,
    bodyHtml: `
      <p>Bonjour ${p},</p>
      <p>Vous avez apprécié votre climatiseur ? Nous vous proposons de le <strong>conserver définitivement</strong>, au prix exceptionnel de <strong>${prix}</strong>.</p>
      <div class="box">
        <p style="margin:0 0 4px;color:#888;font-size:12px">OFFRE PRIVILÈGE</p>
        <p style="margin:0;font-size:17px;font-weight:700;color:#1a2b4a">Achetez votre ${appareil} — ${prix}</p>
        <p style="margin:6px 0 0;font-size:13px;color:#666">Prix définitif, sans frais supplémentaires. L'appareil est à vous.</p>
      </div>
      <p>Pour accepter ou décliner cette offre, rendez-vous dans votre espace client avec votre numéro de dossier (<strong>${r}</strong>).</p>
      <p style="font-size:13px;color:#888">Cette offre est valable jusqu'à la fin de votre location. Si vous ne faites rien, l'appareil sera récupéré normalement à la date prévue — aucune action requise de votre part.</p>`,
    ctaHref: 'https://www.locair.fr/client',
    ctaLabel: 'Voir l\'offre dans mon espace →',
  });
}

// Relance commerciale d'un client dormant (Module 8) — n'a pas reloué
// depuis longtemps (voir cron-monthly.js, runDormantClientsWinback).
// Réutilise le système de code promo déterministe déjà en place
// (api/_lib/promo.js), aucune nouvelle infrastructure de code.
function tplRelanceDormant({ prenom, codePromo, lang }) {
  const l = lang || 'fr';
  const p = escHtml(prenom || '');
  if (l === 'en') return wrap({
    title: "We haven't forgotten you!",
    intro: `Hello ${p}, it's been a while — here's a discount for your next rental.`,
    bodyHtml: `
      <div class="box"><p style="margin:0 0 4px;color:#888;font-size:12px">YOUR PROMO CODE</p><strong style="font-size:22px;color:#1b3a5f;letter-spacing:.05em">${escHtml(codePromo)}</strong></div>
      <p>Use it when booking on our website — the discount applies automatically.</p>`,
    ctaHref: 'https://www.locair.fr',
    ctaLabel: 'Book now →',
  });
  if (l === 'zh') return wrap({
    title: '我们没有忘记您！',
    intro: `您好 ${p}，好久不见——这是您下次租赁的专属优惠码。`,
    bodyHtml: `
      <div class="box"><p style="margin:0 0 4px;color:#888;font-size:12px">您的优惠码</p><strong style="font-size:22px;color:#1b3a5f;letter-spacing:.05em">${escHtml(codePromo)}</strong></div>
      <p>在我们网站预订时使用——折扣将自动扣除。</p>`,
    ctaHref: 'https://www.locair.fr',
    ctaLabel: '立即预订 →',
  });
  if (l === 'ru') return wrap({
    title: 'Мы о вас не забыли!',
    intro: `Здравствуйте, ${p}! Давно не виделись — вот скидка для вашей следующей аренды.`,
    bodyHtml: `
      <div class="box"><p style="margin:0 0 4px;color:#888;font-size:12px">ВАШ ПРОМОКОД</p><strong style="font-size:22px;color:#1b3a5f;letter-spacing:.05em">${escHtml(codePromo)}</strong></div>
      <p>Используйте его при бронировании на нашем сайте — скидка применится автоматически.</p>`,
    ctaHref: 'https://www.locair.fr',
    ctaLabel: 'Забронировать →',
  });
  return wrap({
    title: 'On ne vous a pas oublié !',
    intro: `Bonjour ${p}, ça fait un moment — voici une réduction pour votre prochaine location.`,
    bodyHtml: `
      <div class="box"><p style="margin:0 0 4px;color:#888;font-size:12px">VOTRE CODE PROMO</p><strong style="font-size:22px;color:#1b3a5f;letter-spacing:.05em">${escHtml(codePromo)}</strong></div>
      <p>Utilisez-le au moment de réserver sur notre site — la réduction s'applique automatiquement.</p>`,
    ctaHref: 'https://www.locair.fr',
    ctaLabel: 'Réserver maintenant →',
  });
}

module.exports = {
  escHtml, wrap,
  tplConfirmation, tplSuiviJ14, tplPreparationJ3, tplRappelJ1,
  tplPostInstallation, tplAvantFinLocation, tplRappelRecuperation, tplFinLocation,
  tplProlongConfirmation, tplContratFacture, tplContratFactureProlongation, tplFactureVente,
  tplAmbassadeurCredentials, tplNouveauCodeAmbassadeur, tplNouveauCodeTransporteur,
  tplLienPaiement, tplRelanceDormant, tplOffrePrivilege,
};
