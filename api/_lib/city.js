// Un déploiement = une ville (voir CITY object dans index.html). Le slug se règle
// via la variable d'env CITY_SLUG pour qu'un futur déploiement (nouvelle ville)
// n'ait qu'une seule valeur à changer.
async function getCity(supabase) {
  const slug = process.env.CITY_SLUG || 'nice';
  const { data, error } = await supabase.from('cities').select('*').eq('slug', slug).single();
  if (error || !data) throw new Error(`Ville introuvable pour le slug "${slug}"`);
  return data;
}

module.exports = { getCity };
