// "Ouvert" = pas encore traité par l'administration. 'retard_a_facturer' n'en
// fait pas partie : dès qu'un incident de retard atteint ce statut, l'action
// nécessaire est connue (facturer le client) — il n'attend plus l'attention
// de l'admin de la même façon qu'un incident 'nouveau'/'en_analyse'.
const INCIDENT_OPEN_STATUSES = ['nouveau', 'en_analyse'];

module.exports = { INCIDENT_OPEN_STATUSES };
