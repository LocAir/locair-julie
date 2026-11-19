// Prix affiché AVANT le paiement pour une location Click & Collect : prix
// normal ou majoré par la tarification dynamique (_lib/tarifDynamique.js) — même calcul que le paiement (_lib/clickCollect.js),
// donc le client voit exactement ce qu'il paiera. Dit aussi si le point
// choisi est complet.
const { getSupabase } = require('./_lib/supabase');
const { getPricingConfig } = require('./_lib/pricing');
const { isValidDate, todayParis } = require('./_lib/dates');
const { getPointRetrait } = require('./_lib/pointsRetrait');
const { prixClickCollect } = require('./_lib/clickCollect');
const { signerDevis } = require('./_lib/tarifDynamique');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const q = req.query || {};
  const point = getPointRetrait(String(q.point || '').slice(0, 60));
  const debut = String(q.debut || '').slice(0, 10);
  const jours = parseInt(q.jours, 10);
  if (!point || !isValidDate(debut) || debut < todayParis() || !Number.isFinite(jours) || jours < 1 || jours > 90) {
    return res.status(400).json({ error: 'Paramètres invalides' });
  }
  try {
    const supabase = getSupabase();
    const pricing = await getPricingConfig(supabase);
    const p = await prixClickCollect(supabase, point, debut, jours, pricing);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      totalCents: p.totalCents, normalCents: p.normalCents, majore: p.majore,
      majorationPct: p.majorationPct, complet: p.libresAuPoint < 1,
      raisons: p.raisons || [], remise: !!p.remise, variationPct: p.variationPct || 0,
      // prix garanti 30 min (voir _lib/tarifDynamique.js)
      devis: signerDevis({ point: point.id, debut, jours, cents: p.totalCents }),
    });
  } catch (e) {
    console.error('[click-collect-prix]', e.message);
    return res.status(500).json({ error: 'Prix indisponible' });
  }
};
