// Webhook WhatsApp Cloud API (Meta)
// Détecte les mots-clés d'incident → envoie un message de dépannage automatique
// + promesse de rappel technicien le lendemain matin.
//
// Variables d'env requises :
//   WHATSAPP_VERIFY_TOKEN    — jeton arbitraire à copier dans la console Meta
//   WHATSAPP_ACCESS_TOKEN    — token d'accès permanent (System User Token)
//   WHATSAPP_PHONE_NUMBER_ID — ID du numéro dans Meta Business Suite

const KEYWORDS = [
  'problème','probleme',
  'marche plus','ne marche','marche pas',
  'refroidit','refroidis','ne refroidit','ne refroidis','refroidit pas','refroidis pas',
  "s'allume",'ne s allume','allume pas','ne s\'allume','s allume pas',
  'fuit','fuite',
  'panne',
  'cassé','cassée','cassee','ne fonctionne','fonctionne pas',
  'trop chaud','chaleur','chauffe',
  'arrête','arrete','s\'arrête','s arrête','s arrete',
  'éteint tout seul','eteint','éteint seul',
  'bruit bizarre','bruyant','fait du bruit',
  'erreur','affiche erreur',
  'ne démarre','demarre pas','ne démarr',
  'clim','climatiseur',  // contexte négatif souvent présent
];

// Normalise une chaîne pour comparaison insensible aux accents/casse
function norm(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['']/g, "'");
}

function hasKeyword(text) {
  const t = norm(text);
  // Pour "clim"/"climatiseur" seuls, on exige un contexte négatif
  const generalTerms = ['clim','climatiseur'];
  const negativeCtx  = ['problème','probleme','ne','plus','pas','panne','fuit','fuite','arrêt','arret','bruit','chaud','cassé','cassee'];
  for (const kw of KEYWORDS) {
    const kwNorm = norm(kw);
    if (!generalTerms.includes(kwNorm)) {
      if (t.includes(kwNorm)) return true;
    } else {
      // terme générique → n'auto-répond que s'il y a aussi un mot négatif
      if (t.includes(kwNorm) && negativeCtx.some(c => t.includes(norm(c)))) return true;
    }
  }
  return false;
}

const REPLY = `Bonjour 👋

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

_Message automatique — notre équipe suit votre demande en parallèle._`;

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

module.exports = async (req, res) => {
  // ── Vérification du webhook (GET envoyé par Meta lors de la configuration) ─
  if (req.method === 'GET') {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  // ── Traitement des messages entrants ──────────────────────────────────────
  try {
    const payload = req.body;
    // Meta envoie parfois des notifications de statut (delivered, read…) — ignorer
    if (payload?.object !== 'whatsapp_business_account') return res.status(200).send('OK');

    for (const entry of payload?.entry || []) {
      for (const change of entry?.changes || []) {
        if (change?.field !== 'messages') continue;
        for (const msg of change?.value?.messages || []) {
          if (msg.type !== 'text') continue;
          const text = msg.text?.body || '';
          const from = msg.from;           // numéro international sans +

          if (!hasKeyword(text)) continue; // message hors périmètre → pas de réponse auto

          await sendReply(from, REPLY);
        }
      }
    }

    // Meta exige toujours un 200 OK — sinon il renvoie le message en boucle
    return res.status(200).send('OK');
  } catch (err) {
    console.error('[WhatsApp webhook]', err.message);
    return res.status(200).send('OK');
  }
};
