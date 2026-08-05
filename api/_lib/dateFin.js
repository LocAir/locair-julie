const { addDays } = require('./dates');

// Tous les id de réservation d'une même "famille" (l'origine + toutes ses
// prolongations confirmées ou non) — sert à regarder à travers TOUTE la
// chaîne plutôt que la seule réservation d'origine, qui ne porte plus la
// mission de récupération réelle dès qu'une prolongation a pris le relais.
async function getFamilyReservationIds(supabase, origId) {
  const { data: prolongIds } = await supabase
    .from('reservations').select('id').eq('reservation_origine_id', origId);
  return [origId, ...(prolongIds || []).map(p => p.id)];
}

// La mission de récupération réellement active (pas annulée/refusée) pour
// toute la famille — c'est la SEULE source fiable de "quand le technicien
// vient vraiment" et "quel créneau" : mise à jour en place à chaque
// reprogrammation (client-recup.js, admin-livraisons.js action 'update'),
// jamais recréée. Renvoie null si aucune récupération active n'est trouvée
// (ex. réservation sans id, ou déjà toutes "fait"/annulées).
async function getActiveRecuperationMission(supabase, origId) {
  if (!origId) return null;
  const allIds = await getFamilyReservationIds(supabase, origId);
  const { data: recup } = await supabase
    .from('livraisons').select('date_prevue, creneau')
    .in('reservation_id', allIds).eq('type', 'recuperation')
    .not('statut', 'in', '(annule,annulee,refusee)')
    .order('date_prevue', { ascending: false }).limit(1).maybeSingle();
  return recup || null;
}

// Date de fin RÉELLE d'un contrat — prolongations payées déjà confirmées ET
// récupération reprogrammée à la main par l'admin (admin-livraisons.js
// action 'update', ex. le client demande à garder l'appareil quelques jours
// de plus sans passer par une prolongation payante) comprises.
// reservations.date_fin sur la réservation d'ORIGINE est mise à jour à
// chaque confirmation de prolongation (webhook.js, admin-reservations.js),
// mais toujours en fire-and-forget (jamais garanti à 100%, voir les .then()
// qui avalent l'erreur) — sans ce filet de sécurité, une prolongation dont
// la mise à jour de date_fin aurait raté pour une raison quelconque rejette
// à tort toute nouvelle prolongation ("déjà terminée"), ou affiche une durée
// figée dans l'espace client/l'appli transporteur. Reprend la date la plus
// TARDIVE entre : la réservation d'origine, sa dernière prolongation
// confirmée, et la date de récupération (moins 1 jour) actuellement
// planifiée — sert à ne jamais SOUS-estimer la durée réelle du contrat
// (utile pour calculer une nouvelle prolongation, par ex.).
//
// N'est PAS la bonne fonction pour savoir "quand le technicien vient
// vraiment" : une récupération avancée par le client (client-recup.js) rend
// cette date plus TÔT que date_fin, ce que le MAX ci-dessous ignore
// volontairement — voir getActiveRecuperationMission ci-dessus pour ce
// besoin (utilisé par cron-daily.js/emailEngine.js/reservations.js pour le
// rappel de récupération, capture d'écran à l'appui, 2026-08-05).
//
// Module séparé de _lib/reservations.js et _lib/emailEngine.js (qui
// l'utilisent tous les deux) pour éviter une dépendance circulaire entre
// les deux — reservations.js require déjà emailEngine.js.
async function getEffectiveDateFin(supabase, origId, origDateFin) {
  if (!origId) return origDateFin;
  let effective = origDateFin;

  const { data: dernierProlong } = await supabase
    .from('reservations').select('date_fin')
    .eq('reservation_origine_id', origId).eq('statut', 'confirmee')
    .order('date_fin', { ascending: false }).limit(1).maybeSingle();
  if (dernierProlong?.date_fin && dernierProlong.date_fin > effective) effective = dernierProlong.date_fin;

  const recup = await getActiveRecuperationMission(supabase, origId);
  if (recup?.date_prevue) {
    const recupEnd = addDays(recup.date_prevue, -1);
    if (recupEnd > effective) effective = recupEnd;
  }

  return effective;
}

module.exports = { getEffectiveDateFin, getActiveRecuperationMission, getFamilyReservationIds };
