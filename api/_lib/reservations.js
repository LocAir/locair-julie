// Confirme une réservation après paiement Stripe réussi et crée les missions
// terrain (livraisons) associées. Idempotent : sans effet si déjà traité, pour
// tolérer les livraisons en double des webhooks Stripe.
async function confirmReservationAndCreateLivraisons(supabase, paymentIntentId) {
  const { data: resa, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();
  if (error || !resa) return null;
  if (resa.statut === 'confirmee') return resa; // déjà traité

  await supabase.from('reservations').update({ statut: 'confirmee' }).eq('id', resa.id);

  const { data: existing } = await supabase.from('livraisons').select('id').eq('reservation_id', resa.id);
  if (!existing || existing.length === 0) {
    const rows = resa.source === 'site_prolongation'
      ? [{ reservation_id: resa.id, type: 'recuperation', date_prevue: resa.date_fin }]
      : [
          { reservation_id: resa.id, type: 'livraison',    date_prevue: resa.date_debut },
          { reservation_id: resa.id, type: 'recuperation', date_prevue: resa.date_fin },
        ];
    await supabase.from('livraisons').insert(rows);
  }

  // Prolongation : la récupération initialement prévue à la date de début de
  // l'extension est désormais obsolète (le client garde l'appareil plus longtemps).
  if (resa.source === 'site_prolongation' && resa.email) {
    const { data: stale } = await supabase
      .from('reservations')
      .select('id')
      .eq('city_id', resa.city_id)
      .eq('email', resa.email)
      .eq('date_fin', resa.date_debut)
      .neq('id', resa.id);
    if (stale && stale.length) {
      await supabase.from('livraisons')
        .update({ statut: 'annule' })
        .in('reservation_id', stale.map(r => r.id))
        .eq('type', 'recuperation')
        .eq('statut', 'a_faire');
    }
  }

  return resa;
}

module.exports = { confirmReservationAndCreateLivraisons };
