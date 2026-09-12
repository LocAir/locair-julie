const { getSupabase } = require('./_lib/supabase');
const { getProduitsVente } = require('./_lib/vente');

// Lecture publique des climatiseurs proposés à la vente — lue par
// /acheter-climatiseur pour afficher le prix, le modèle et le délai.
// Ne peut jamais faire échouer la page : si la migration n'est pas
// appliquée, si la base est injoignable, ou si aucun modèle n'est mis en
// vente, la réponse est une liste vide et la page reste en « demander le
// prix ». Même contrat que /api/forfaits.
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  // Deux minutes de cache, comme /api/disponibilite : un prix de vente ne
  // change pas plusieurs fois par heure.
  res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=60');
  try {
    const produits = await getProduitsVente(getSupabase());
    return res.status(200).json({ produits });
  } catch (err) {
    console.error('[produits-vente]', err.message);
    return res.status(200).json({ produits: [] });
  }
};
