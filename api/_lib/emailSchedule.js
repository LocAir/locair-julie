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
// `recupDatePrevue` (optionnel) : date réellement planifiée de la mission de
// récupération (livraisons.date_prevue, voir getActiveRecuperationMission,
// _lib/dateFin.js) — quand fournie, PRIME sur le calcul par défaut
// (date_fin + 1 jour) pour décider si "rappel_recuperation" est dû. Sans
// elle, un client qui avance sa récupération (client-recup.js) ou une
// récupération reprogrammée par l'admin (admin-livraisons.js) recevait le
// rappel au mauvais moment — calculé sur l'ancienne date, jamais sur la
// vraie date planifiée (capture d'écran à l'appui, 2026-08-05). Repli sur
// l'ancien calcul si absente (rétrocompatible, tests existants).
function scenariosDueToday(reservation, todayISO, { recupDatePrevue } = {}) {
  if (!reservation || reservation.statut !== 'confirmee') return [];
  if (!reservation.date_debut || !reservation.date_fin) return [];

  const dDebut = daysDiff(todayISO, reservation.date_debut); // jours restants avant livraison
  const dFin   = daysDiff(todayISO, reservation.date_fin);   // jours restants avant récupération
  const duree  = daysDiff(reservation.date_debut, reservation.date_fin);

  const due = [];
  // J-14 : seules les réservations avec au moins 14 jours de délai peuvent
  // jamais atteindre dDebut===14 un jour donné (sinon la fenêtre n'existe
  // structurellement pas dans leur calendrier) — aucun contrôle séparé requis.
  if (dDebut === 14 || dDebut === 13) due.push('suivi_j14');
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
  // Par défaut, la mission de récupération est programmée à date_fin + 1
  // jour (jamais le jour même — voir confirmReservation dans
  // _lib/reservations.js), donc le rappel "la veille de la récupération"
  // part le jour de date_fin (dFin===0). Si la vraie date planifiée est
  // connue (recupDatePrevue) et diffère de ce calcul par défaut (récupération
  // avancée ou reprogrammée), c'est elle qui prime.
  const recupDue = recupDatePrevue
    ? daysDiff(todayISO, recupDatePrevue) === 1
    : dFin === 0;
  if (recupDue) due.push('rappel_recuperation');
  return due;
}

function scenarioDate(baseISO, offsetDays) {
  const d = new Date(String(baseISO).slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

// Sœur de scenariosDueToday() : au lieu d'un booléen "dû aujourd'hui",
// calcule la date calendaire exacte de chacun des scénarios pilotés par
// date (5 emails + 2 SMS automatisés, sms_relance_prolongation et
// sms_rappel_recuperation — mêmes fenêtres que avant_fin_location et
// rappel_recuperation, voir cron-daily.js) et ne garde que celles pas
// encore passées — pour afficher/pauser un envoi à venir depuis la fiche
// client (panneau Communications). Le jour "pivot" de chaque fenêtre (ex.
// J-3 plutôt que J-2, le rattrapage de scenariosDueToday) est celui
// affiché : c'est la date réellement visée, pas la marge de rattrapage.
function upcomingScenariosForReservation(reservation, todayISO, { recupDatePrevue } = {}) {
  if (!reservation || reservation.statut !== 'confirmee') return [];
  if (!reservation.date_debut || !reservation.date_fin) return [];
  const duree = daysDiff(reservation.date_debut, reservation.date_fin);
  // Voir scenariosDueToday ci-dessus pour le même repli/priorité.
  const recupDate = recupDatePrevue ? scenarioDate(recupDatePrevue, 1) : scenarioDate(reservation.date_fin, 0);

  const candidats = [
    { scenario: 'suivi_j14',           date: scenarioDate(reservation.date_debut, 14) },
    { scenario: 'preparation_j3',      date: scenarioDate(reservation.date_debut, 3) },
    { scenario: 'rappel_j1',           date: scenarioDate(reservation.date_debut, 1) },
    ...(duree > 4 ? [{ scenario: 'avant_fin_location', date: scenarioDate(reservation.date_fin, 3) }] : []),
    ...(duree > 4 ? [{ scenario: 'sms_relance_prolongation', date: scenarioDate(reservation.date_fin, 4) }] : []),
    { scenario: 'rappel_recuperation', date: recupDate },
    { scenario: 'sms_rappel_recuperation', date: recupDate },
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
function pastScenariosForReservation(reservation, todayISO, { recupDatePrevue } = {}) {
  if (!reservation || !['confirmee', 'terminee'].includes(reservation.statut)) return [];
  if (!reservation.date_debut || !reservation.date_fin) return [];
  const duree = daysDiff(reservation.date_debut, reservation.date_fin);
  // Voir scenariosDueToday ci-dessus pour le même repli/priorité.
  const recupDate = recupDatePrevue ? scenarioDate(recupDatePrevue, 1) : scenarioDate(reservation.date_fin, 0);

  const candidats = [
    { scenario: 'suivi_j14',           date: scenarioDate(reservation.date_debut, 14) },
    { scenario: 'preparation_j3',      date: scenarioDate(reservation.date_debut, 3) },
    { scenario: 'rappel_j1',           date: scenarioDate(reservation.date_debut, 1) },
    ...(duree > 4 ? [{ scenario: 'avant_fin_location', date: scenarioDate(reservation.date_fin, 3) }] : []),
    ...(duree > 4 ? [{ scenario: 'sms_relance_prolongation', date: scenarioDate(reservation.date_fin, 4) }] : []),
    { scenario: 'rappel_recuperation', date: recupDate },
    { scenario: 'sms_rappel_recuperation', date: recupDate },
  ];
  return candidats.filter(c => c.date < todayISO);
}

// Une réservation "d'origine" (pas une prolongation) reste 'confirmee' pour
// toujours même après qu'une prolongation ait pris le relais (voir
// confirmReservation dans _lib/reservations.js — sa date_fin est resynchronisée
// par webhook.js/admin-reservations.js mais son statut ne bascule jamais tout
// seul). Sans cette exclusion, les rappels/relances automatiques partiraient
// deux fois pour la même location (une fois par fiche) — et une prolongation
// "intermédiaire" (remplacée par une prolongation plus récente qui continue
// exactement là où elle s'arrête) resterait tout autant à tort dans les listes
// actives. `peers` : les autres réservations du même client à comparer
// (même email+ville, ou même client_id selon l'appelant) — à l'appelant de
// les fournir déjà filtrées sur le bon périmètre (un client peut avoir
// plusieurs séjours totalement indépendants dans le temps : `peers` peut
// donc contenir bien plus que la seule chaîne de prolongation concernée).
//
// `reservation_origine_id` (migration_reservation_origine.sql) donne un lien
// fiable, exempt de toute coïncidence de dates, entre une prolongation et la
// réservation qu'elle prolonge — posé uniquement à la création (prolong-pay.js,
// checkout-prolong.js, admin-reservations.js). Les réservations créées avant
// cette migration n'ont pas cette colonne renseignée : on retombe alors sur
// l'ancienne méthode par correspondance exacte de date, qui reste correcte
// dans l'immense majorité des cas (l'invariant est vrai *entre une origine et
// SA propre prolongation*, seule une coïncidence de calendrier entre deux
// séjours indépendants du même client pourrait la tromper).
function isSupersededReservation(resa, peers) {
  const others = (peers || []).filter(r => r.id !== resa.id && ['confirmee', 'terminee'].includes(r.statut));
  if (resa.source !== 'site_prolongation') {
    return others.some(r => {
      if (r.source !== 'site_prolongation') return false;
      if (r.reservation_origine_id != null) return r.reservation_origine_id === resa.id;
      return r.date_fin === resa.date_fin;
    });
  }
  return others.some(r => {
    if (r.source !== 'site_prolongation') return false;
    if (resa.reservation_origine_id != null && r.reservation_origine_id != null) {
      return r.reservation_origine_id === resa.reservation_origine_id && r.date_fin > resa.date_fin;
    }
    return r.date_debut === resa.date_fin;
  });
}

module.exports = { scenariosDueToday, upcomingScenariosForReservation, pastScenariosForReservation, daysDiff, isSupersededReservation };
