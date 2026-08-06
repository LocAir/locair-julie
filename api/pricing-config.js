const { getSupabase } = require('./_lib/supabase');
const { getPricingConfig } = require('./_lib/pricing');

// Lecture publique des tarifs actuels — utilisée par le site (simulateur de
// prix, textes affichés), les CGV et la page retard pour ne jamais recopier
// les chiffres à la main : une seule source (pricing_config, modifiable
// depuis l'admin via admin-pricing.js), tout le reste s'aligne dessus.
// getPricingConfig() ne jette jamais (repli sur les tarifs par défaut si la
// base est injoignable) — cet endpoint ne peut donc jamais faire planter
// l'affichage du prix sur le site.
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const pricing = await getPricingConfig(getSupabase());
    return res.status(200).json({ pricing });
  } catch (err) {
    console.error('[pricing-config]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
