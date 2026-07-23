// Historique des mouvements de stock (Module 6, Partie 5) — un seul point
// d'écriture pour le statut ET la localisation d'un appareil : chaque appel
// journalise l'événement en plus de mettre à jour l'appareil. "Aucun
// mouvement matériel ne doit être invisible."
async function recordMouvement(supabase, {
  appareilId, typeEvenement, nouveauStatut, nouvelleLocalisation,
  livraisonId = null, reservationId = null, utilisateur = null, commentaire = null, coutCents = null,
}) {
  if (!appareilId) return;
  const { data: avant } = await supabase
    .from('appareils').select('statut, localisation').eq('id', appareilId).maybeSingle();
  // nouveauStatut omis = déplacement pur (ex. départ entrepôt) : le statut ne
  // change pas, seule la localisation bouge.
  const statutFinal = nouveauStatut || avant?.statut || null;

  const { error: updErr } = await supabase.from('appareils').update({
    statut: statutFinal, localisation: nouvelleLocalisation,
  }).eq('id', appareilId);
  if (updErr) throw updErr;

  const { error: insErr } = await supabase.from('appareil_mouvements').insert({
    appareil_id: appareilId, type_evenement: typeEvenement,
    ancien_statut: avant?.statut || null, nouveau_statut: statutFinal,
    ancienne_localisation: avant?.localisation || null, nouvelle_localisation: nouvelleLocalisation,
    livraison_id: livraisonId, reservation_id: reservationId,
    utilisateur, commentaire, cout_cents: coutCents,
  });
  if (insErr) throw insErr;
}

// Localisation par défaut associée à un statut donné — utile quand seul le
// nouveau statut est connu (ex. mise à jour manuelle admin) sans vouloir
// imposer une localisation précise à chaque site d'appel.
const LOCALISATION_PAR_STATUT = {
  disponible: 'stock_principal',
  nettoyage:  'stock_principal',
  maintenance: 'maintenance',
  panne:      'maintenance',
  loue:       'chez_client',
};

module.exports = { recordMouvement, LOCALISATION_PAR_STATUT };
