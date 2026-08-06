// Tarif dégressif par palier — barème unique, utilisé partout où un nombre de
// jours doit être converti en prix (réservation, prolongation incrémentale,
// facturation de retard, contrat PDF). Une seule implémentation : jusqu'ici
// recopiée à l'identique dans checkout.js, checkout-prolong.js,
// charge-retard.js et cron-daily.js, avec le risque qu'un correctif de tarif
// n'atteigne pas les 4.
//
// Les valeurs elles-mêmes (12/10/9/8 €/jour, paliers 7/14/21 jours) vivent
// maintenant dans la table pricing_config (panneau de contrôle admin,
// voir admin-pricing.js) — plus figées en dur ici. DEFAULT_PRICING_CONFIG
// ci-dessous reste le SEUL filet de sécurité si la base est injoignable ou
// si la ligne n'existe pas encore (avant que la migration soit collée) :
// jamais d'erreur qui casserait un paiement, juste un repli sur les tarifs
// historiques.
const DEFAULT_PRICING_CONFIG = {
  duree_min_jours:     7,
  palier1_max_jours:   7,  palier1_tarif_cents: 1200,
  palier2_max_jours:   14, palier2_tarif_cents: 1000,
  palier3_max_jours:   21, palier3_tarif_cents: 900,
  palier4_tarif_cents: 800,
};

const PRICING_NUMERIC_FIELDS = [
  'duree_min_jours',
  'palier1_max_jours', 'palier1_tarif_cents',
  'palier2_max_jours', 'palier2_tarif_cents',
  'palier3_max_jours', 'palier3_tarif_cents',
  'palier4_tarif_cents',
];
// Une ligne existe mais une colonne manque (migration collée en plusieurs
// fois, ALTER TABLE interrompu...) : Supabase ne renvoie AUCUNE erreur dans
// ce cas — `select('*')` renvoie juste la ligne sans le champ manquant. Sans
// ce contrôle, un palier undefined se propage en NaN dans calcTieredPrice,
// jusqu'au montant envoyé à Stripe (paiement qui échoue avec une erreur
// obscure au lieu de simplement utiliser les tarifs par défaut).
function isCompletePricingRow(row) {
  return row && PRICING_NUMERIC_FIELDS.every((f) => Number.isFinite(row[f]));
}

// Lit la config tarifaire en base — à appeler une fois par requête (jamais
// mise en cache d'un appel serverless à l'autre, chaque invocation Vercel
// repart de zéro de toute façon) puis passée en paramètre à calcTieredPrice/
// dailyRate ci-dessous. Ne jette JAMAIS : un souci Supabase ne doit pas
// empêcher un paiement, juste retomber sur les tarifs par défaut.
async function getPricingConfig(supabase) {
  try {
    const { data, error } = await supabase.from('pricing_config').select('*').eq('id', 1).maybeSingle();
    if (error || !isCompletePricingRow(data)) return DEFAULT_PRICING_CONFIG;
    return data;
  } catch (e) {
    console.error('[pricing] getPricingConfig:', e.message);
    return DEFAULT_PRICING_CONFIG;
  }
}

// `config` optionnel : repli sur DEFAULT_PRICING_CONFIG si omis (compat
// ascendante — certains appels historiques/tests peuvent ne pas encore
// passer la config chargée).
function calcTieredPrice(days, config) {
  const c = config || DEFAULT_PRICING_CONFIG;
  days = Math.max(1, days);
  if (days <= c.palier1_max_jours) return days * (c.palier1_tarif_cents / 100);
  if (days <= c.palier2_max_jours) {
    return c.palier1_max_jours * (c.palier1_tarif_cents / 100)
      + (days - c.palier1_max_jours) * (c.palier2_tarif_cents / 100);
  }
  if (days <= c.palier3_max_jours) {
    return c.palier1_max_jours * (c.palier1_tarif_cents / 100)
      + (c.palier2_max_jours - c.palier1_max_jours) * (c.palier2_tarif_cents / 100)
      + (days - c.palier2_max_jours) * (c.palier3_tarif_cents / 100);
  }
  return c.palier1_max_jours * (c.palier1_tarif_cents / 100)
    + (c.palier2_max_jours - c.palier1_max_jours) * (c.palier2_tarif_cents / 100)
    + (c.palier3_max_jours - c.palier2_max_jours) * (c.palier3_tarif_cents / 100)
    + (days - c.palier3_max_jours) * (c.palier4_tarif_cents / 100);
}

// Tarif journalier "plat" du palier auquel appartient un jour donné — utilisé
// pour le prélèvement automatique de retard (un montant par jour de retard,
// pas un cumul) : contrairement à calcTieredPrice(j) - calcTieredPrice(j-1),
// ça évite les montants aberrants aux frontières de palier (0 € ou négatif).
function dailyRate(day, config) {
  const c = config || DEFAULT_PRICING_CONFIG;
  day = Math.max(1, day);
  if (day <= c.palier1_max_jours) return c.palier1_tarif_cents / 100;
  if (day <= c.palier2_max_jours) return c.palier2_tarif_cents / 100;
  if (day <= c.palier3_max_jours) return c.palier3_tarif_cents / 100;
  return c.palier4_tarif_cents / 100;
}

module.exports = { calcTieredPrice, dailyRate, getPricingConfig, DEFAULT_PRICING_CONFIG };
