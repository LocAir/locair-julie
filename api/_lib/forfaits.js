// Packs à prix fixe (ex. "Pack Sérénité Solo/Duo") — voir
// migration_forfaits.sql. Contrairement au tarif dégressif (pricing.js) ou
// à une remise en % (promotions.js), un forfait a un prix TOTAL figé pour
// une durée et une quantité précises : il ne bouge jamais, même si le
// barème normal change ensuite.
async function getActiveForfaits(supabase) {
  try {
    const { data, error } = await supabase.from('forfaits').select('*').eq('actif', true).order('quantite');
    if (error) return [];
    return data || [];
  } catch (e) {
    console.error('[forfaits] getActiveForfaits:', e.message);
    return [];
  }
}

// Renvoie le forfait uniquement s'il est actif ET que la durée/quantité
// demandées correspondent exactement — sinon null. Ne jette jamais : un
// forfait qu'on ne retrouve plus doit juste faire retomber le checkout sur
// le tarif dégressif normal, jamais bloquer un paiement.
async function getMatchingForfait(supabase, { forfaitId, duree, quantite }) {
  if (!forfaitId) return null;
  try {
    const { data, error } = await supabase.from('forfaits').select('*').eq('id', forfaitId).eq('actif', true).maybeSingle();
    if (error || !data) return null;
    if (data.duree_jours !== duree || data.quantite !== quantite) return null;
    return data;
  } catch (e) {
    console.error('[forfaits] getMatchingForfait:', e.message);
    return null;
  }
}

module.exports = { getActiveForfaits, getMatchingForfait };
