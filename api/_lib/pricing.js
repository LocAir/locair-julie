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

// ── Grille PRO ────────────────────────────────────────────────────────────
// Loc'Air loue deux choses très différentes : un climatiseur mobile à un
// particulier, et un rafraîchisseur adiabatique à une entreprise. Même
// mécanique dégressive, tarifs sans rapport. Les colonnes pro_* sont
// OPTIONNELLES en base : tant qu'elles n'existent pas, on retombe sur les
// valeurs ci-dessous, et rien ne casse entre le déploiement du code et le
// moment où la migration est collée. C'est volontaire — le site a déjà été
// cassé une fois par une colonne utilisée avant d'exister.
const DEFAULT_PRO_PRICING = {
  duree_min_jours:     1,      // un événement peut durer un seul jour
  palier1_max_jours:   7,  palier1_tarif_cents: 4000,
  palier2_max_jours:   14, palier2_tarif_cents: 3400,
  palier3_max_jours:   21, palier3_tarif_cents: 3000,
  palier4_tarif_cents: 2700,
};
// Forfait unique côté pro : livraison + installation + reprise, compté une
// seule fois quel que soit le nombre d'appareils. Il REMPLACE les frais de
// livraison et d'installation des particuliers, il ne s'y ajoute pas.
const DEFAULT_PRO_FORFAIT_CENTS = 12000;

const PRO_FIELDS = [
  'pro_duree_min_jours',
  'pro_palier1_tarif_cents', 'pro_palier2_tarif_cents',
  'pro_palier3_tarif_cents', 'pro_palier4_tarif_cents',
  'pro_forfait_cents',
];

// Fabrique une config au MÊME format que la grille particuliers, pour que
// calcTieredPrice() n'ait pas à savoir de quelle offre il s'agit. Les seuils
// de jours (7/14/21) sont partagés : seuls les tarifs changent.
function getProPricing(config) {
  const c = config || {};
  const ok = PRO_FIELDS.every((f) => Number.isFinite(c[f]));
  if (!ok) return DEFAULT_PRO_PRICING;
  return {
    duree_min_jours:     c.pro_duree_min_jours,
    palier1_max_jours:   c.palier1_max_jours,  palier1_tarif_cents: c.pro_palier1_tarif_cents,
    palier2_max_jours:   c.palier2_max_jours,  palier2_tarif_cents: c.pro_palier2_tarif_cents,
    palier3_max_jours:   c.palier3_max_jours,  palier3_tarif_cents: c.pro_palier3_tarif_cents,
    palier4_tarif_cents: c.pro_palier4_tarif_cents,
  };
}

function getProForfaitCents(config) {
  const v = config && config.pro_forfait_cents;
  return Number.isFinite(v) ? v : DEFAULT_PRO_FORFAIT_CENTS;
}

// Une commande est « pro » dès que le tunnel a coché entreprise. Même test
// que celui déjà utilisé pour enregistrer type_client en base, pour qu'il
// n'y ait jamais deux définitions du mot « pro ».
function isPro(typeClient) {
  return String(typeClient || '').toLowerCase().startsWith('pro')
      || String(typeClient || '').toLowerCase().startsWith('entrep');
}

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

module.exports = {
  calcTieredPrice, dailyRate, getPricingConfig, DEFAULT_PRICING_CONFIG,
  getProPricing, getProForfaitCents, isPro,
  DEFAULT_PRO_PRICING, DEFAULT_PRO_FORFAIT_CENTS,
};
