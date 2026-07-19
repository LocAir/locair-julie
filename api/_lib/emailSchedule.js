// Fenêtres de déclenchement des scénarios email pilotés par date (cron
// quotidien) — fonctions pures, sans accès réseau/DB, pour rester testables
// unitairement. Les scénarios événementiels (confirmation, post_installation,
// fin_location) ne sont PAS ici : ils sont déclenchés directement par le code
// métier (webhook Stripe, actions transporteur), pas par un calcul de date.
function daysDiff(fromISO, toISO) {
  const a = new Date(String(fromISO).slice(0, 10) + 'T00:00:00Z');
  const b = new Date(String(toISO).slice(0, 10) + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

// `todayISO` : jour du traitement (cron), format 'YYYY-MM-DD'.
// `reservation` : { statut, date_debut, date_fin } — le statut doit être
// 'confirmee' (une réservation en_attente/annulee/remboursee/terminee ne
// reçoit plus aucun rappel de ce type).
function scenariosDueToday(reservation, todayISO) {
  if (!reservation || reservation.statut !== 'confirmee') return [];
  if (!reservation.date_debut || !reservation.date_fin) return [];

  const dDebut = daysDiff(todayISO, reservation.date_debut); // jours restants avant livraison
  const dFin   = daysDiff(todayISO, reservation.date_fin);   // jours restants avant récupération
  const duree  = daysDiff(reservation.date_debut, reservation.date_fin);

  const due = [];
  // J-14 : seules les réservations avec au moins 14 jours de délai peuvent
  // jamais atteindre dDebut===14 un jour donné (sinon la fenêtre n'existe
  // structurellement pas dans leur calendrier) — aucun contrôle séparé requis.
  if (dDebut === 14) due.push('suivi_j14');
  // J-3 : petite marge [2,3] pour absorber un cron manqué un jour, sans
  // jamais chevaucher la fenêtre J-1 stricte ci-dessous.
  if (dDebut === 3 || dDebut === 2) due.push('preparation_j3');
  // J-1 livraison : fenêtre exacte, aucun rattrapage — "ne jamais envoyer un
  // rappel après la livraison" (si le cron a manqué ce jour précis, tant pis,
  // on ne l'envoie jamais en retard).
  if (dDebut === 1) due.push('rappel_j1');
  // Proposition de prolongation : uniquement si la location dure plus de 4
  // jours (évite d'envoyer l'email le jour même ou le lendemain de la livraison
  // pour les courtes locations 3-4 jours introduites en juillet 2026).
  if (duree > 4 && (dFin === 3 || dFin === 2)) due.push('avant_fin_location');
  // Rappel récupération (conservé de l'existant, hors des 7 scénarios
  // demandés mais utile opérationnellement — voir rapport de fin de module).
  // La mission de récupération elle-même est programmée à date_fin + 1 jour
  // (jamais le jour même — voir confirmReservation dans _lib/reservations.js),
  // donc le rappel "la veille de la récupération" part le jour de date_fin
  // (dFin===0), pas la veille de date_fin.
  if (dFin === 0) due.push('rappel_recuperation');
  return due;
}

function scenarioDate(baseISO, offsetDays) {
  const d = new Date(String(baseISO).slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

// Sœur de scenariosDueToday() : au lieu d'un booléen "dû aujourd'hui",
// calcule la date calendaire exacte de chacun des 5 scénarios pilotés par
// date et ne garde que celles pas encore passées — pour afficher/pauser un
// envoi à venir depuis la fiche client (panneau Communications). Le jour
// "pivot" de chaque fenêtre (ex. J-3 plutôt que J-2, le rattrapage de
// scenariosDueToday) est celui affiché : c'est la date réellement visée,
// pas la marge de rattrapage.
function upcomingScenariosForReservation(reservation, todayISO) {
  if (!reservation || reservation.statut !== 'confirmee') return [];
  if (!reservation.date_debut || !reservation.date_fin) return [];
  const duree = daysDiff(reservation.date_debut, reservation.date_fin);

  const candidats = [
    { scenario: 'suivi_j14',           date: scenarioDate(reservation.date_debut, 14) },
    { scenario: 'preparation_j3',      date: scenarioDate(reservation.date_debut, 3) },
    { scenario: 'rappel_j1',           date: scenarioDate(reservation.date_debut, 1) },
    ...(duree > 4 ? [{ scenario: 'avant_fin_location', date: scenarioDate(reservation.date_fin, 3) }] : []),
    { scenario: 'rappel_recuperation', date: scenarioDate(reservation.date_fin, 0) },
  ];
  return candidats.filter(c => c.date >= todayISO);
}

// Sœur "en retard" de upcomingScenariosForReservation() : mêmes candidats,
// mais ne garde que les dates déjà passées — pour détecter une anomalie
// ("ce rappel aurait dû partir il y a 3 jours et n'est jamais parti"), voir
// le panneau Communications (_lib/communicationsCockpit.js). Ne dit rien
// sur si l'email a réellement été envoyé ou volontairement sauté — à
// croiser avec email_sent/email_skip par l'appelant, exactement comme pour
// upcomingScenariosForReservation().
//
// Statut accepté plus large ('confirmee' OU 'terminee') que les 2 fonctions
// sœurs ci-dessus : une réservation passe à 'terminee' dès la récupération
// effectuée (voir transporteur-action.js), potentiellement le jour même où
// rappel_recuperation était dû — une anomalie sur ce rappel doit donc
// pouvoir être détectée même après ce changement de statut. L'appelant
// reste responsable de ne jamais passer une réservation annulée/remboursée
// (pour laquelle aucun email n'était de toute façon prévu).
function pastScenariosForReservation(reservation, todayISO) {
  if (!reservation || !['confirmee', 'terminee'].includes(reservation.statut)) return [];
  if (!reservation.date_debut || !reservation.date_fin) return [];
  const duree = daysDiff(reservation.date_debut, reservation.date_fin);

  const candidats = [
    { scenario: 'suivi_j14',           date: scenarioDate(reservation.date_debut, 14) },
    { scenario: 'preparation_j3',      date: scenarioDate(reservation.date_debut, 3) },
    { scenario: 'rappel_j1',           date: scenarioDate(reservation.date_debut, 1) },
    ...(duree > 4 ? [{ scenario: 'avant_fin_location', date: scenarioDate(reservation.date_fin, 3) }] : []),
    { scenario: 'rappel_recuperation', date: scenarioDate(reservation.date_fin, 0) },
  ];
  return candidats.filter(c => c.date < todayISO);
}

module.exports = { scenariosDueToday, upcomingScenariosForReservation, pastScenariosForReservation, daysDiff };
