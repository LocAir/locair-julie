// Prix affiché AVANT le paiement pour une location Click & Collect : prix
// normal ou majoré par la tarification dynamique (_lib/tarifDynamique.js) — même calcul que le paiement (_lib/clickCollect.js),
// donc le client voit exactement ce qu'il paiera. Dit aussi si le point
// choisi est complet.
const { getSupabase } = require('./_lib/supabase');
const { getPricingConfig } = require('./_lib/pricing');
const { isValidDate, todayParis, addDays } = require('./_lib/dates');
const { getPointRetrait, POINTS_RETRAIT, pointFermeLe } = require('./_lib/pointsRetrait');
const { prixClickCollect } = require('./_lib/clickCollect');
const { signerDevis } = require('./_lib/tarifDynamique');

// ── Aperçu pour le haut de page (?apercu=1) ──────────────────────────────
// Le vrai prix de demain pour 7 jours (le moins cher des points ouverts
// demain — les vrais points, ou les exemples s'il n'y en a pas encore), et
// le nombre de locations Click & Collect des 7 derniers jours, affiché
// seulement à partir de 10 (jamais un petit chiffre, jamais inventé).
// Gardé 10 min en mémoire : même prix pour tout le monde au même moment.
let apercuCache = null;
async function apercu(supabase) {
  if (apercuCache && Date.now() - apercuCache.t < 10 * 60000) return apercuCache.v;
  const demain = addDays(todayParis(), 1);
  const publics = POINTS_RETRAIT.filter((p) => !p.test);
  const vrais = publics.filter((p) => !p.exemple);
  const points = (vrais.length ? vrais : publics).filter((p) => !pointFermeLe(p, demain) && !pointFermeLe(p, addDays(demain, 7)));
  const pricing = await getPricingConfig(supabase);
  const prix = await Promise.all(points.map((p) => prixClickCollect(supabase, p, demain, 7, pricing).catch(() => null)));
  const ok = prix.filter((x) => x && x.libresAuPoint >= 1);
  const min = ok.length ? Math.min(...ok.map((x) => x.totalCents)) : null;
  let loues = null;
  try {
    const depuis = new Date(Date.now() - 7 * 864e5).toISOString();
    const { count } = await supabase.from('reservations').select('id', { count: 'exact', head: true })
      .eq('source_channel', 'click_collect').in('statut', ['confirmee', 'terminee'])
      .or('source.is.null,source.neq.site_prolongation').gte('created_at', depuis);
    if (count >= 10) loues = count;
  } catch (e) { /* compteur indisponible : on n'affiche rien */ }
  const v = { demain, totalCents: min, plusieursPoints: ok.length > 1, exemples: !vrais.length, loues7j: loues };
  apercuCache = { t: Date.now(), v };
  return v;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const q = req.query || {};
  if (q.apercu === '1') {
    try {
      const v = await apercu(getSupabase());
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(200).json(v);
    } catch (e) {
      console.error('[click-collect-prix apercu]', e.message);
      return res.status(200).json({ totalCents: null, loues7j: null });
    }
  }
  const point = getPointRetrait(String(q.point || '').slice(0, 60));
  const debut = String(q.debut || '').slice(0, 10);
  const jours = parseInt(q.jours, 10);
  if (!point || !isValidDate(debut) || debut < todayParis() || debut > addDays(todayParis(), require('./_lib/clickCollect').AVANCE_MAX_JOURS) || !Number.isFinite(jours) || jours < 1 || jours > 90) {
    return res.status(400).json({ error: 'Paramètres invalides' });
  }
  try {
    const supabase = getSupabase();
    const pricing = await getPricingConfig(supabase);
    const p = await prixClickCollect(supabase, point, debut, jours, pricing);
    res.setHeader('Cache-Control', 'no-store');
    // Hors saison (climatiseurs pas encore déposés, ou déjà repris) : la page
    // l'affiche à la place du prix et bloque « Continuer », comme un point complet.
    const finLoc = require('./_lib/dates').addDays(debut, jours);
    const horsSaisonMsg = require('./_lib/pointsRetrait').horsSaison(point, debut, finLoc);
    if (horsSaisonMsg) return res.status(200).json({ totalCents: p.totalCents, normalCents: p.normalCents, complet: true, hors_saison: horsSaisonMsg, raisons: [] });
    return res.status(200).json({
      totalCents: p.totalCents, normalCents: p.normalCents, majore: p.majore,
      majorationPct: p.majorationPct, complet: p.libresAuPoint < 1,
      // stock bas affiché au client (« Plus que 2 appareils ») : seulement 1 ou 2,
      // jamais le stock exact au-delà — c'est un vrai chiffre, calculé à l'instant.
      libres: p.libresAuPoint >= 1 && p.libresAuPoint <= 2 ? p.libresAuPoint : null,
      raisons: p.raisons || [], remise: !!p.remise, variationPct: p.variationPct || 0,
      // prix garanti 30 min (voir _lib/tarifDynamique.js)
      devis: signerDevis({ point: point.id, debut, jours, cents: p.totalCents }),
    });
  } catch (e) {
    console.error('[click-collect-prix]', e.message);
    return res.status(500).json({ error: 'Prix indisponible' });
  }
};
