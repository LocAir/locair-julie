// Disponibilité = flotte totale de la ville moins les réservations actives qui
// chevauchent la période demandée. Le calcul se fait en base (fonction SQL
// `available_units`, voir supabase/schema.sql) pour rester correct même en cas
// de réservations concurrentes.
async function getAvailability(supabase, cityId, dateDebut, dateFin) {
  const { data, error } = await supabase.rpc('available_units', {
    p_city_id:    cityId,
    p_date_debut: dateDebut,
    p_date_fin:   dateFin,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

module.exports = { getAvailability };
