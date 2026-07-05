// Assigne un ou plusieurs appareils numérotés à une réservation confirmée.
// Idempotent par construction : si des appareils sont déjà liés à cette
// réservation (webhook Stripe redélivré), ne fait rien.
async function assignAppareils(supabase, resa, staleOriginalId) {
  const { data: already } = await supabase
    .from('reservation_appareils').select('id').eq('reservation_id', resa.id).limit(1);
  if (already && already.length) return;

  // Prolongation : le client garde physiquement le même climatiseur, ce n'est
  // pas un nouvel appareil — on reprend celui (ou ceux) de la réservation
  // d'origine plutôt que d'en assigner un autre au hasard.
  let manque = resa.quantite;
  if (staleOriginalId) {
    const { data: origAppareils } = await supabase
      .from('reservation_appareils').select('appareil_id')
      .eq('reservation_id', staleOriginalId).limit(resa.quantite);
    const ids = (origAppareils || []).map(r => r.appareil_id);
    if (ids.length) {
      await supabase.from('reservation_appareils')
        .insert(ids.map(appareil_id => ({ reservation_id: resa.id, appareil_id })));
      manque -= ids.length;
    }
  }

  if (manque > 0) {
    await supabase.rpc('assign_appareils', {
      p_reservation_id: resa.id,
      p_city_id:        resa.city_id,
      p_quantite:       manque,
      p_date_debut:     resa.date_debut,
      p_date_fin:       resa.date_fin,
    });
  }
}

// Confirme une réservation après paiement Stripe réussi, assigne les appareils
// numérotés et crée les missions terrain (livraisons) associées. Idempotent :
// sans effet si déjà traité, pour tolérer les livraisons en double des webhooks Stripe.
async function confirmReservationAndCreateLivraisons(supabase, paymentIntentId) {
  const { data: resa, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();
  if (error || !resa) return null;
  if (resa.statut === 'confirmee') return resa; // déjà traité

  await supabase.from('reservations').update({ statut: 'confirmee' }).eq('id', resa.id);

  // Prolongation : retrouver la réservation d'origine (même client, même ville,
  // récupération initiale = début de l'extension) — sert à la fois à lui
  // transférer les mêmes appareils et à annuler sa récupération devenue obsolète.
  let staleOriginalId = null;
  if (resa.source === 'site_prolongation' && resa.email) {
    const { data: stale } = await supabase
      .from('reservations')
      .select('id')
      .eq('city_id', resa.city_id)
      .eq('email', resa.email)
      .eq('date_fin', resa.date_debut)
      .neq('id', resa.id);
    if (stale && stale.length) {
      staleOriginalId = stale[0].id;
      await supabase.from('livraisons')
        .update({ statut: 'annule' })
        .in('reservation_id', stale.map(r => r.id))
        .eq('type', 'recuperation')
        .eq('statut', 'a_faire');
    }
  }

  await assignAppareils(supabase, resa, staleOriginalId);

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

  return resa;
}

module.exports = { confirmReservationAndCreateLivraisons };
