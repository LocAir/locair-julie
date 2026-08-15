// Vérifie l'éligibilité d'un code promo avant l'étape de paiement.
// Deux cas :
//   1. Code créé par l'admin (table `promotions`) → valide pour tout le monde
//   2. Code de fidélité/parrainage PRENOM10/20/30 → uniquement pour les clients
//      dont l'email figure déjà dans la base (réservation antérieure non annulée)
//
// Le serveur (api/checkout.js → _lib/promotions.js) recalcule indépendamment
// et est la vraie source de vérité — cet endpoint sert uniquement à afficher
// le bon message dans le formulaire avant que le client valide son paiement.

const { getSupabase }        = require('./_lib/supabase');
const { matchPromoPct }      = require('./_lib/promo');
const { getClientIp, isRateLimited } = require('./_lib/ratelimit');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ eligible: false });

  const ip = getClientIp(req);
  try {
    if (await isRateLimited(getSupabase(), `check-promo:${ip}`))
      return res.status(429).json({ eligible: false, reason: 'rate_limited' });
  } catch (_e) { /* ne jamais bloquer l'affichage pour un souci de rate-limit */ }

  const code  = (req.query.code   || '').trim().toUpperCase();
  const email = (req.query.email  || '').trim().toLowerCase();
  const prenom= (req.query.prenom || '').trim();

  if (!code || code.length < 2 || code.length > 60) {
    return res.json({ eligible: false, type: 'none' });
  }

  const supabase = getSupabase();

  // ── 1. Codes créés manuellement par l'admin (table `promotions`) ─────────
  // Fonctionnent pour tout le monde — l'admin a explicitement décidé de les
  // créer. On vérifie juste qu'ils sont actifs et non expirés/épuisés.
  try {
    const { data: promo } = await supabase
      .from('promotions')
      .select('id, type_remise, valeur, date_debut, date_fin, max_utilisations, nb_utilisations')
      .eq('actif', true)
      .ilike('code', code)
      .maybeSingle();

    if (promo && ['pourcentage', 'montant_fixe'].includes(promo.type_remise)
        && Number.isFinite(Number(promo.valeur)) && Number(promo.valeur) > 0) {
      const today = new Date().toISOString().slice(0, 10);
      if (promo.date_debut && today < promo.date_debut)
        return res.json({ eligible: false, type: 'admin', reason: 'pas_encore_active' });
      if (promo.date_fin && today > promo.date_fin)
        return res.json({ eligible: false, type: 'admin', reason: 'expiree' });
      if (promo.max_utilisations != null && (promo.nb_utilisations || 0) >= promo.max_utilisations)
        return res.json({ eligible: false, type: 'admin', reason: 'epuise' });

      if (promo.type_remise === 'pourcentage')
        return res.json({ eligible: true, type: 'admin', pct: Number(promo.valeur) });
      else
        return res.json({ eligible: true, type: 'admin', fixedEuros: Number(promo.valeur) });
    }
  } catch (e) {
    console.error('[check-promo] admin lookup:', e.message);
    // Pas d'erreur renvoyée : on continue avec le filet de secours
  }

  // ── 2. Codes de fidélité/parrainage PRENOM10/20/30 ────────────────────────
  // Uniquement pour les clients dont l'email est déjà dans la base
  // (au moins une réservation non annulée = client existant).
  const pct = matchPromoPct(code, prenom);
  if (pct > 0) {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return res.json({ eligible: false, type: 'loyalty', reason: 'email_required' });
    }
    try {
      const { count } = await supabase
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('email', email)
        .neq('statut', 'annulé');

      if ((count || 0) > 0) {
        return res.json({ eligible: true, type: 'loyalty', pct });
      } else {
        return res.json({ eligible: false, type: 'loyalty', reason: 'nouveau_client' });
      }
    } catch (e) {
      console.error('[check-promo] customer check:', e.message);
      // Fail closed : en cas d'erreur DB, refuser pour éviter tout abus
      return res.json({ eligible: false, type: 'loyalty', reason: 'error' });
    }
  }

  return res.json({ eligible: false, type: 'none' });
};
