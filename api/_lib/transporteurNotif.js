const { pushToTransporteur } = require('./push');
const { sendBrevoSms } = require('./brevo');
const { fmtDateFR } = require('./emailEngine');

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
  // Sans l'id de mission dans l'URL, taper la notification ne fait que
  // ramener l'app au premier plan (voir transporteur/sw.js) — le livreur
  // devait ensuite chercher lui-même la mission concernée dans la liste.
  const url = livraisonId ? `/transporteur/?open=${livraisonId}` : '/transporteur/';
  await pushToTransporteur(supabase, transporteurId, { title: "Loc'Air", body: message, tag: tag || type, url });
  await smsNouvelleMission(supabase, transporteurId, { type, livraisonId });
}

// SMS en plus du push (ajouté le 2026-07-27, à la demande du propriétaire) —
// le push navigateur n'arrive que si l'app est ouverte et la permission
// accordée : sans ça, un transporteur peut mettre des heures à découvrir une
// nouvelle mission alors que le SMS, lui, arrive toujours. Réservé au seul
// type 'nouvelle_mission' (les autres — incident, annulation, paiement...
// — restent push + centre de notifications, pas assez urgents pour un SMS).
// Ne fait jamais échouer l'appelant, même contrat que le reste de cette
// fonction.
async function smsNouvelleMission(supabase, transporteurId, { type, livraisonId }) {
  if (type !== 'nouvelle_mission' || !livraisonId) return;
  try {
    const [{ data: transporteur }, { data: liv }] = await Promise.all([
      supabase.from('transporteurs').select('telephone, taux_livraison_cents, taux_recuperation_cents').eq('id', transporteurId).maybeSingle(),
      supabase.from('livraisons').select('type, date_prevue, creneau, reservation:reservations(adresse, installation)').eq('id', livraisonId).maybeSingle(),
    ]);
    if (!transporteur?.telephone || !liv) return;
    // Une ligne par info (type, date/créneau, adresse, installation,
    // rémunération, lien) plutôt qu'une seule phrase dense — plus rapide à
    // lire d'un coup d'œil sur le lock screen d'un téléphone.
    const estRecuperation = liv.type === 'recuperation';
    const libelle = estRecuperation ? 'Récupération' : 'Livraison';
    const dateFmt = fmtDateFR(liv.date_prevue);
    const adresse = liv.reservation?.adresse || '';
    // Pertinent seulement à la livraison : à la récupération, l'appareil est
    // simplement repris, quel qu'ait été le mode d'installation initial.
    // "Technicien (80€)" côté reservations.installation est le prix payé par
    // le CLIENT pour ce service — à ne jamais confondre avec la rémunération
    // du transporteur ci-dessous (taux fixe par mission, indépendant du mode
    // d'installation), d'où le libellé volontairement dépouillé de tout prix.
    const estTechnicien = (liv.reservation?.installation || '').startsWith('Technicien');
    const installationLigne = !estRecuperation
      ? (estTechnicien ? 'Installation par vous (technicien)' : 'Installation autonome (client)')
      : null;
    const remunerationCents = estRecuperation
      ? (transporteur.taux_recuperation_cents || 0)
      : (transporteur.taux_livraison_cents || 0);
    const remunerationFmt = (remunerationCents / 100).toFixed(2).replace('.', ',') + ' €';
    const lignes = [
      "Loc'Air - Nouvelle mission",
      '',
      libelle,
      `${dateFmt}${liv.creneau ? ', créneau ' + liv.creneau : ''}`,
    ];
    if (adresse) lignes.push(adresse);
    if (installationLigne) lignes.push(installationLigne);
    lignes.push(`Rémunération : ${remunerationFmt}`);
    lignes.push('', `Accepter : https://www.locair.fr/transporteur/?open=${livraisonId}`);
    const content = lignes.join('\n');
    const result = await sendBrevoSms({ to: transporteur.telephone, content });
    if (!result.ok) console.error('[Notif transporteur SMS]', result.error);
  } catch (e) {
    console.error('[Notif transporteur SMS]', e.message);
  }
}

module.exports = { notifyTransporteur };
