const { pushToTransporteur } = require('./push');

// Centre de notifications transporteur (Module 5, Partie 11) : persiste
// l'événement pour l'onglet "Notifications" (lu/non lu, historique) ET
// envoie le push navigateur existant — un seul point d'appel pour les deux.
// Ne fait jamais échouer l'appelant (même contrat que pushToTransporteur).
async function notifyTransporteur(supabase, transporteurId, { type, message, livraisonId = null, tag = null }) {
  if (!transporteurId || !type || !message) return;
  try {
    await supabase.from('transporteur_notifications').insert({
      transporteur_id: transporteurId, type, message, livraison_id: livraisonId,
    });
  } catch (e) {
    console.error('[Notif transporteur]', e.message);
  }
  await pushToTransporteur(supabase, transporteurId, { title: "Loc'Air", body: message, tag: tag || type });
}

module.exports = { notifyTransporteur };
