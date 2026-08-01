const { pushToTransporteur } = require('./push');
const { sendBrevoSms } = require('./brevo');
const { fmtDateFR } = require('./emailEngine');
const { computeBareme, getBaremeForCity } = require('./bareme');

// Centre de notifications transporteur (Module 5, Partie 11) : persiste
// l'événement pour l'onglet "Notifications" (lu/non lu, historique) ET
// envoie le push navigateur existant — un seul point d'appel pour les deux.
// Ne fait jamais échouer l'appelant (même contrat que pushToTransporteur).
function periodLabel(dates) {
  if (!dates || !dates.length) return null;
  const sorted = dates.map(d => new Date(d)).sort((a, b) => a - b);
  const ref = sorted[sorted.length - 1]; // mission la plus récente
  const dow = ref.getDay();
  const monday = new Date(ref);
  monday.setDate(ref.getDate() - (dow === 0 ? 6 : dow - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d, opts) => d.toLocaleDateString('fr-FR', opts);
  if (monday.getMonth() === sunday.getMonth()) {
    return `semaine du ${fmt(monday, { day: 'numeric' })} au ${fmt(sunday, { day: 'numeric', month: 'long' })}`;
  }
  return `semaine du ${fmt(monday, { day: 'numeric', month: 'short' })} au ${fmt(sunday, { day: 'numeric', month: 'short' })}`;
}

async function notifyTransporteur(supabase, transporteurId, { type, message, livraisonId = null, tag = null, montantCents = null, missionDates = null }) {
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
  await smsPaiement(supabase, transporteurId, { type, montantCents, missionDates });
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
      supabase.from('transporteurs').select('telephone').eq('id', transporteurId).maybeSingle(),
      supabase.from('livraisons').select('type, date_prevue, creneau, montant_manuel, montant_du_cents, reservation:reservations(adresse, installation, city_id, hors_zone)').eq('id', livraisonId).maybeSingle(),
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
    // du transporteur ci-dessous (barème Loc'Air, indépendant du mode
    // d'installation), d'où le libellé volontairement dépouillé de tout prix.
    const estTechnicien = (liv.reservation?.installation || '').startsWith('Technicien');
    const installationLigne = !estRecuperation
      ? (estTechnicien ? 'Installation par vous (technicien)' : 'Installation autonome (client)')
      : null;
    // Même barème (par ville, éditable dans l'admin) et même garde
    // montant_manuel que ce qui sera réellement versé au transporteur — voir
    // transporteur-action.js ('terminer') et admin-livraisons.js
    // ('force_complete'). Avant ce correctif, le SMS lisait
    // transporteurs.taux_livraison_cents/taux_recuperation_cents : des
    // colonnes mortes depuis le passage au barème par ville (PR barème
    // éditable), jamais éditables depuis l'admin et donc toujours à 0 —
    // le SMS annonçait "Rémunération : 0,00 €" quel que soit le barème
    // configuré par ville.
    let remunerationCents = liv.montant_du_cents || 0;
    if (!liv.montant_manuel) {
      const tarifs = await getBaremeForCity(supabase, liv.reservation?.city_id);
      remunerationCents = computeBareme(liv.type, liv.reservation?.installation, tarifs, liv.reservation?.hors_zone);
    }
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

async function smsPaiement(supabase, transporteurId, { type, montantCents, missionDates }) {
  if (type !== 'paiement' || !montantCents || montantCents <= 0) return;
  try {
    const { data: t } = await supabase.from('transporteurs').select('telephone').eq('id', transporteurId).maybeSingle();
    if (!t?.telephone) return;
    const montantFmt = (montantCents / 100).toFixed(2).replace('.', ',') + ' €';
    const periode = periodLabel(missionDates);
    const content = `Loc'Air — Virement de ${montantFmt}${periode ? ', ' + periode : ''} effectué. https://www.locair.fr/transporteur/?tab=activite`;
    const result = await sendBrevoSms({ to: t.telephone, content });
    if (!result.ok) console.error('[Notif transporteur paiement SMS]', result.error);
  } catch (e) {
    console.error('[Notif transporteur paiement SMS]', e.message);
  }
}

module.exports = { notifyTransporteur };
