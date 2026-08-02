// Webhook WhatsApp Cloud API (Meta)
// Détecte les mots-clés d'incident (FR/EN/ZH) → envoie un guide de dépannage
// automatique + promesse de rappel technicien le lendemain matin.
//
// Variables d'env requises :
//   WHATSAPP_VERIFY_TOKEN    — jeton arbitraire à copier dans la console Meta
//   WHATSAPP_ACCESS_TOKEN    — token d'accès permanent (System User Token)
//   WHATSAPP_PHONE_NUMBER_ID — ID du numéro dans Meta Business Suite

const KEYWORDS = [
  // FR
  'problème','probleme','marche plus','ne marche','marche pas',
  'refroidit','refroidis','ne refroidit','ne refroidis','refroidit pas','refroidis pas',
  "s'allume",'ne s allume','allume pas','ne s\'allume','s allume pas',
  'fuit','fuite','panne','cassé','cassée','cassee','ne fonctionne','fonctionne pas',
  'trop chaud','chaleur','chauffe','arrête','arrete','s\'arrête','s arrête','s arrete',
  'éteint tout seul','eteint','éteint seul','bruit bizarre','bruyant','fait du bruit',
  'erreur','affiche erreur','ne démarre','demarre pas','ne démarr',
  'clim','climatiseur',
  // EN
  'not working','broken','leaking','dripping','strange noise','noisy',
  'not cooling','too hot','stopped working','error code','won\'t turn on','wont turn on',
  'not cold','water leak','problem with','issue with','trouble with',
  'ac not','air con',
  // ZH
  '不工作','漏水','坏了','有问题','噪音','停了','错误','不制冷','不冷','不开机',
  '故障','损坏','太热','制冷','空调',
  // RU
  'не работает','не охлаждает','не включается','не холодит','не холодно',
  'поломка','сломан','сломалась','сломался','течет','течёт','протечка',
  'шумит','шум','проблема','ошибка','остановился','остановилась',
  'жарко','горячо','кондиционер','кондей',
];

function norm(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['']/g, "'");
}

// Détecte la langue du message entrant pour répondre dans la bonne langue
function detectLang(text) {
  if (/[一-鿿]/.test(text)) return 'zh';
  if (/[а-яёА-ЯЁ]/.test(text)) return 'ru';
  const t = text.toLowerCase();
  const enMarkers = ['not working','broken','leaking','too hot','stopped','error','not cool','not cold','problem','issue','air con','ac not'];
  if (enMarkers.some(k => t.includes(k))) return 'en';
  return 'fr';
}

function hasKeyword(text) {
  const t = norm(text);
  const tRaw = text; // pour la détection des caractères CJK / cyrilliques
  // Caractères chinois → toujours pertinent
  if (/[一-鿿]/.test(tRaw)) {
    const zhTerms = ['不工作','漏水','坏了','有问题','噪音','停了','错误','不制冷','不冷','不开机','故障','损坏','太热','制冷','空调'];
    if (zhTerms.some(k => tRaw.includes(k))) return true;
  }
  // Cyrillique (russe) → match direct sans normalisation
  if (/[а-яёА-ЯЁ]/.test(tRaw)) {
    const ruTerms = ['не работает','не охлаждает','не включается','не холодит','не холодно',
      'поломка','сломан','сломалась','сломался','течет','течёт','протечка',
      'шумит','шум','проблема','ошибка','остановился','остановилась',
      'жарко','горячо','кондиционер','кондей'];
    if (ruTerms.some(k => tRaw.toLowerCase().includes(k))) return true;
  }
  const generalTerms = ['clim','climatiseur','ac not','air con','空调','制冷'];
  const negativeCtx  = ['problème','probleme','ne','plus','pas','panne','fuit','fuite','arrêt','arret','bruit','chaud','cassé','cassee',
                        'not','broken','leak','noise','stopped','error','cold','hot','故障','损坏','不'];
  for (const kw of KEYWORDS) {
    const kwNorm = norm(kw);
    if (!generalTerms.map(g => norm(g)).includes(kwNorm)) {
      if (t.includes(kwNorm)) return true;
    } else {
      if (t.includes(kwNorm) && negativeCtx.some(c => t.includes(norm(c)))) return true;
    }
  }
  return false;
}

const REPLY = {
  fr: `Bonjour 👋

Merci pour votre message. Voici les vérifications rapides à effectuer :

🔧 *Guide de dépannage Loc'Air*

1️⃣ *Gaine d'évacuation* — vérifiez qu'elle est bien fixée et orientée vers l'extérieur (fenêtre ou grille de ventilation).

2️⃣ *Filtre* — retirez et nettoyez le filtre du panneau avant (à dévisser). Un filtre encrassé divise par deux la puissance de froid.

3️⃣ *Mode refroidissement* — vérifiez que le symbole ❄️ est bien sélectionné sur la télécommande (pas le mode ventilation seul).

4️⃣ *Redémarrage* — éteignez l'appareil, débranchez-le 30 secondes, puis rebranchez.

5️⃣ *Bac à condensats* — si l'appareil s'arrête seul, le bac est peut-être plein. Utilisez le cordon de vidange à l'arrière.

➡️ Plus d'aide : https://locair.fr/#faq

---
Si votre problème *n'est pas résolu*, un technicien Loc'Air vous rappellera *demain matin entre 8h et 12h* 📞

_Message automatique — notre équipe suit votre demande en parallèle._`,

  en: `Hello 👋

Thank you for your message. Here are some quick checks to try:

🔧 *Loc'Air Troubleshooting Guide*

1️⃣ *Exhaust duct* — make sure it is properly fitted and pointing outside (through the window or vent).

2️⃣ *Filter* — remove and clean the front panel filter (unscrew it). A clogged filter cuts cooling power in half.

3️⃣ *Cooling mode* — check that the ❄️ symbol is selected on the remote (not fan-only mode).

4️⃣ *Restart* — turn the unit off, unplug it for 30 seconds, then plug it back in.

5️⃣ *Condensate tank* — if the unit shuts off by itself, the tank may be full. Use the drain cord at the back.

➡️ More help: https://locair.fr/#faq

---
If your issue *is not resolved*, a Loc'Air technician will call you *tomorrow morning between 8am and 12pm* 📞

_Automated message — our team is also following up on your request._`,

  zh: `您好 👋

感谢您的留言。请先尝试以下快速检查：

🔧 *Loc'Air 故障排除指南*

1️⃣ *排风管* — 确认排风管已牢固连接并朝向室外（通过窗户或通风口排出）。

2️⃣ *过滤网* — 取下并清洗前面板过滤网（拧下即可）。过滤网堵塞会使制冷效果减半。

3️⃣ *制冷模式* — 确认遥控器上已选择 ❄️ 符号（而非仅风扇模式）。

4️⃣ *重启* — 关闭设备，拔掉电源等待30秒，再重新接通。

5️⃣ *冷凝水盒* — 如设备自动关机，水盒可能已满，请使用机器背面的排水管排水。

➡️ 更多帮助：https://locair.fr/#faq

---
如问题*仍未解决*，Loc'Air 技术员将于*明天早上8时至12时致电*联系您 📞

_自动回复 — 我们的团队正在同步跟进您的请求。_`,

  ru: `Здравствуйте 👋

Спасибо за ваше сообщение. Вот несколько быстрых проверок:

🔧 *Руководство по устранению неисправностей Loc'Air*

1️⃣ *Выхлопной шланг* — убедитесь, что он надёжно закреплён и направлен наружу (через окно или вентиляционную решётку).

2️⃣ *Фильтр* — снимите и почистите фильтр на передней панели (откручивается). Загрязнённый фильтр снижает мощность охлаждения вдвое.

3️⃣ *Режим охлаждения* — проверьте, что на пульте выбран символ ❄️ (а не только режим вентиляции).

4️⃣ *Перезапуск* — выключите прибор, отключите его от розетки на 30 секунд, затем включите снова.

5️⃣ *Поддон конденсата* — если прибор выключается сам по себе, поддон, возможно, переполнен. Воспользуйтесь дренажной трубкой сзади.

➡️ Дополнительная помощь: https://locair.fr/#faq

---
Если проблема *не решена*, техник Loc'Air перезвонит вам *завтра утром с 8:00 до 12:00* 📞

_Автоматическое сообщение — наша команда параллельно следит за вашим запросом._`,
};

async function sendReply(to, body) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token   = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) {
    console.warn('[WhatsApp] WHATSAPP_PHONE_NUMBER_ID ou WHATSAPP_ACCESS_TOKEN manquant');
    return;
  }
  const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
    }),
  });
  if (!r.ok) console.error('[WhatsApp send]', r.status, await r.text());
}

const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');

const handler = async (req, res) => {
  if (req.method === 'GET') {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const rawBody = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return res.status(403).send('Forbidden');
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return res.status(403).send('Forbidden');
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return res.status(403).send('Forbidden');
  } catch { return res.status(403).send('Forbidden'); }

  try {
    const payload = JSON.parse(rawBody.toString());
    if (payload?.object !== 'whatsapp_business_account') return res.status(200).send('OK');

    const supabase = getSupabase();

    for (const entry of payload?.entry || []) {
      for (const change of entry?.changes || []) {
        if (change?.field !== 'messages') continue;
        for (const msg of change?.value?.messages || []) {
          if (msg.type !== 'text') continue;
          const text = msg.text?.body || '';
          const from = msg.from;

          if (!hasKeyword(text)) continue;

          const { error: insertError } = await supabase
            .from('whatsapp_messages_vus')
            .insert({ msg_id: msg.id });
          if (insertError) continue;

          const lang = detectLang(text);
          await sendReply(from, REPLY[lang] || REPLY.fr);
        }
      }
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('[WhatsApp webhook]', err.message);
    return res.status(200).send('OK');
  }
};

handler.config = { api: { bodyParser: false } };
module.exports = handler;
