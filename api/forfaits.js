const { getSupabase } = require('./_lib/supabase');
const { getActiveForfaits } = require('./_lib/forfaits');

// Lecture publique des packs à prix fixe actuellement actifs (ex. "Pack
// Sérénité Solo/Duo") — utilisée par le site pour afficher les cartes de
// pack. getActiveForfaits() ne jette jamais (liste vide si la base est
// injoignable ou si la table n'existe pas encore) : cet endpoint ne peut
// jamais faire planter la page d'accueil, au pire aucun pack ne s'affiche.
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const forfaits = await getActiveForfaits(getSupabase());
    return res.status(200).json({ forfaits });
  } catch (err) {
    console.error('[forfaits]', err.message);
    return res.status(200).json({ forfaits: [] });
  }
};
