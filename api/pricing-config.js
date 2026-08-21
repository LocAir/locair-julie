const { getSupabase } = require('./_lib/supabase');
const { getPricingConfig, getProPricing, getProForfaitCents } = require('./_lib/pricing');

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
    // La grille pro voyage avec : la page entreprises lit les mêmes chiffres
    // que ceux qui seront facturés, au lieu de les recopier dans son HTML.
    // Tant que les colonnes pro_* n'existent pas, ce sont les valeurs par
    // défaut qui partent — jamais une erreur, jamais un prix vide.
    const pro = getProPricing(pricing);
    pro.forfait_cents = getProForfaitCents(pricing);
    return res.status(200).json({ pricing, pro });
  } catch (err) {
    console.error('[pricing-config]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
