const { addDays } = require('./dates');

// Date de fin RÉELLE d'un contrat — prolongations payées déjà confirmées ET
// récupération reprogrammée à la main par l'admin (admin-livraisons.js
// action 'update', ex. le client demande à garder l'appareil quelques jours
// de plus sans passer par une prolongation payante) comprises.
// reservations.date_fin sur la réservation d'ORIGINE est mise à jour à
// chaque confirmation de prolongation (webhook.js, admin-reservations.js),
// mais toujours en fire-and-forget (jamais garanti à 100%, voir les .then()
// qui avalent l'erreur) — sans ce filet de sécurité, une prolongation dont
// la mise à jour de date_fin aurait raté pour une raison quelconque rejette
// à tort toute nouvelle prolongation ("déjà terminée"), affiche une durée
// figée dans l'espace client/l'appli transporteur, ou déclenche un rappel de
// récupération plusieurs jours trop tôt par rapport à la vraie date (capture
// d'écran à l'appui, 2026-08-05). Reprend la date la plus tardive entre : la
// réservation d'origine, sa dernière prolongation confirmée, et la date de
// récupération (moins 1 jour, la récup étant toujours programmée en J+1)
// actuellement planifiée, sur l'origine ou une de ses prolongations.
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

  const { data: prolongIds } = await supabase
    .from('reservations').select('id').eq('reservation_origine_id', origId);
  const allIds = [origId, ...(prolongIds || []).map(p => p.id)];
  const { data: recup } = await supabase
    .from('livraisons').select('date_prevue')
    .in('reservation_id', allIds).eq('type', 'recuperation')
    .not('statut', 'in', '(annule,annulee,refusee)')
    .order('date_prevue', { ascending: false }).limit(1).maybeSingle();
  if (recup?.date_prevue) {
    const recupEnd = addDays(recup.date_prevue, -1);
    if (recupEnd > effective) effective = recupEnd;
  }

  return effective;
}

module.exports = { getEffectiveDateFin };
