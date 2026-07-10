const { extractPostalCode } = require('./postal');

// Historique : un déploiement = une ville (voir CITY object dans index.html),
// résolue via CITY_SLUG. Conservé le temps que tous les appelants migrent
// vers resolveCityById/resolveCityByAddress (voir plan multi-ville) — ne pas
// utiliser dans du nouveau code.
async function getCity(supabase) {
  const slug = process.env.CITY_SLUG || 'nice';
  const { data, error } = await supabase.from('cities').select('*').eq('slug', slug).single();
  if (error || !data) throw new Error(`Ville introuvable pour le slug "${slug}"`);
  return data;
}

// Villes/zones actives — alimente le sélecteur admin et le tableau de bord
// agrégé.
async function listCities(supabase) {
  const { data, error } = await supabase.from('cities').select('*').eq('actif', true).order('name');
  if (error) throw error;
  return data || [];
}

// Ville explicite (id envoyé par l'admin, ex. sélecteur de ville). Renvoie
// null (pas d'exception) si l'id est absent/invalide/inactif.
async function resolveCityById(supabase, cityId) {
  const id = parseInt(cityId, 10);
  if (!id) return null;
  const { data, error } = await supabase
    .from('cities').select('*').eq('id', id).eq('actif', true).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Résout la zone à partir de l'adresse de livraison — priorité au code
// postal structuré capturé côté site (autocomplete adresse.gouv.fr),
// repli sur une extraction regex dans le texte libre sinon (réservation
// manuelle, visiteur qui a tapé sans choisir de suggestion). Renvoie null
// (pas d'exception) si aucune zone active ne couvre ce code postal — à
// l'appelant de décider du message ("hors zone de livraison").
async function resolveCityByAddress(supabase, adresse, codePostal) {
  const cp = (codePostal || '').trim() || extractPostalCode(adresse);
  if (!cp) return null;
  const { data, error } = await supabase
    .from('cities').select('*').eq('actif', true).contains('postal_codes', [cp]).limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

module.exports = { getCity, listCities, resolveCityById, resolveCityByAddress };
