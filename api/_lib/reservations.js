const { pushToTransporteur } = require('./push');

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

// Confirme une réservation (paiement Stripe réussi OU confirmation manuelle par
// l'admin, ex. réservation prise par téléphone), assigne les appareils
// numérotés et crée les missions terrain (livraisons) associées. Idempotent :
// sans effet si déjà confirmée, pour tolérer les livraisons en double des
// webhooks Stripe redélivrés.
async function confirmReservation(supabase, resa) {
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
      // Récupère les transporteurs déjà assignés avant d'annuler, pour pouvoir
      // les prévenir (même téléphone fermé) qu'une mission qu'on leur avait
      // confiée n'a plus lieu d'être.
      const { data: toCancel } = await supabase
        .from('livraisons').select('id, transporteur_id')
        .in('reservation_id', stale.map(r => r.id))
        .eq('type', 'recuperation')
        .eq('statut', 'a_faire');
      if (toCancel && toCancel.length) {
        await supabase.from('livraisons').update({ statut: 'annule' }).in('id', toCancel.map(l => l.id));
        const transpIds = [...new Set(toCancel.map(l => l.transporteur_id).filter(Boolean))];
        for (const tid of transpIds) {
          await pushToTransporteur(supabase, tid, {
            title: 'Mission annulée',
            body:  'Une récupération a été annulée — le client a prolongé sa location.',
            tag:   'mission-annulee',
          });
        }
      }
    }
  }

  await assignAppareils(supabase, resa, staleOriginalId);

  const { data: existing } = await supabase.from('livraisons').select('id').eq('reservation_id', resa.id);
  if (!existing || existing.length === 0) {
    // Le créneau choisi par le client sur le site (reservations.creneau) doit
    // atteindre la mission opérationnelle — jusqu'ici il finissait seulement
    // dans l'email de confirmation, jamais dans le planning admin/livreur.
    // Pour une réservation normale, resa.creneau = créneau de LIVRAISON choisi
    // par le client (la récupération reste "coordonnée par l'équipe", jamais
    // choisie côté site — pas de créneau à pré-remplir). Pour une prolongation,
    // resa.creneau = créneau de RÉCUPÉRATION choisi par le client.
    const rows = resa.source === 'site_prolongation'
      ? [{ reservation_id: resa.id, type: 'recuperation', date_prevue: resa.date_fin, creneau: resa.creneau || null }]
      : [
          { reservation_id: resa.id, type: 'livraison',    date_prevue: resa.date_debut, creneau: resa.creneau || null },
          { reservation_id: resa.id, type: 'recuperation', date_prevue: resa.date_fin },
        ];
    await supabase.from('livraisons').insert(rows);
  }

  return resa;
}

// Point d'entrée du webhook Stripe : retrouve la réservation par son
// PaymentIntent puis délègue à confirmReservation.
async function confirmReservationAndCreateLivraisons(supabase, paymentIntentId) {
  const { data: resa, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();
  if (error || !resa) return null;
  return confirmReservation(supabase, resa);
}

module.exports = { confirmReservationAndCreateLivraisons, confirmReservation };
