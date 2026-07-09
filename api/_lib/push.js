const webpush = require('web-push');

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:contact@locair.fr',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  configured = true;
  return true;
}

// Envoie une notification push à toutes les sessions connues d'un transporteur
// (plusieurs appareils/onglets possibles). Ne fait jamais échouer l'appelant :
// une notification manquée ne doit jamais bloquer une action métier (assignation,
// annulation...). Purge automatiquement les abonnements révoqués/expirés (404/410).
async function pushToTransporteur(supabase, transporteurId, { title, body, tag }) {
  if (!ensureConfigured() || !transporteurId) return;
  try {
    const { data: subs } = await supabase
      .from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('transporteur_id', transporteurId);
    if (!subs || !subs.length) return;

    const payload = JSON.stringify({ title, body, tag, url: '/transporteur/' });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', s.id);
        } else {
          console.error('[Push]', e.message);
        }
      }
    }));
  } catch (e) {
    console.error('[Push]', e.message);
  }
}

module.exports = { pushToTransporteur };
