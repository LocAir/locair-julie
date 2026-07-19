// Barème Loc'Air — éditable par ville depuis l'admin (onglet Villes), avec
// ces valeurs par défaut tant qu'une ville n'a pas de tarifs personnalisés
// (ou avant que la migration ajoutant les colonnes ait été appliquée en
// prod) — comportement strictement inchangé par rapport à l'ancien barème
// fixe en dur.
const DEFAULTS = {
  livraison_autonome:   3000,
  livraison_technicien: 4000,
  recuperation:          3000,
  changement:            4000,
};

// Grille hors zone (Module 9) : fixe, identique pour toutes les villes —
// remplace le barème normal ci-dessus dès qu'une mission est marquée
// hors_zone sur sa réservation. Décidé par Aly le jour où Loc'Air a
// commencé à livrer hors de sa zone habituelle (facturée 95€ au client
// contre 35€ en zone, cf. index.html) : le transporteur doit être mieux
// payé pour ces trajets plus longs.
const HORS_ZONE_TARIFS = {
  livraison_autonome:   5000,
  livraison_technicien: 9500,
  recuperation:          5000,
  changement:            5000,
};

async function getBaremeForCity(supabase, cityId) {
  if (!cityId) return DEFAULTS;
  try {
    const { data, error } = await supabase
      .from('cities')
      .select('tarif_livraison_autonome_cents, tarif_livraison_technicien_cents, tarif_recuperation_cents, tarif_changement_cents')
      .eq('id', cityId).maybeSingle();
    if (error || !data) return DEFAULTS;
    return {
      livraison_autonome:   data.tarif_livraison_autonome_cents   ?? DEFAULTS.livraison_autonome,
      livraison_technicien: data.tarif_livraison_technicien_cents ?? DEFAULTS.livraison_technicien,
      recuperation:          data.tarif_recuperation_cents         ?? DEFAULTS.recuperation,
      changement:            data.tarif_changement_cents           ?? DEFAULTS.changement,
    };
  } catch (e) {
    return DEFAULTS;
  }
}

// Variante pour les endpoints qui listent des missions de plusieurs villes
// à la fois (ex. transporteur couvrant plusieurs zones) — une requête par
// ville distincte plutôt qu'une par mission.
async function getBaremeByCityIds(supabase, cityIds) {
  const ids = [...new Set((cityIds || []).filter(Boolean))];
  const map = {};
  if (!ids.length) return map;
  try {
    const { data, error } = await supabase
      .from('cities')
      .select('id, tarif_livraison_autonome_cents, tarif_livraison_technicien_cents, tarif_recuperation_cents, tarif_changement_cents')
      .in('id', ids);
    if (error || !data) return map;
    data.forEach(c => {
      map[c.id] = {
        livraison_autonome:   c.tarif_livraison_autonome_cents   ?? DEFAULTS.livraison_autonome,
        livraison_technicien: c.tarif_livraison_technicien_cents ?? DEFAULTS.livraison_technicien,
        recuperation:          c.tarif_recuperation_cents         ?? DEFAULTS.recuperation,
        changement:            c.tarif_changement_cents           ?? DEFAULTS.changement,
      };
    });
  } catch (e) { /* map reste vide, computeBareme retombe sur DEFAULTS */ }
  return map;
}

function computeBareme(type, installation, tarifs, horsZone) {
  const t = horsZone ? HORS_ZONE_TARIFS : (tarifs || DEFAULTS);
  if (type === 'changement')  return t.changement;
  if (type === 'recuperation') return t.recuperation;
  return (installation || '').startsWith('Technicien') ? t.livraison_technicien : t.livraison_autonome;
}

module.exports = { computeBareme, getBaremeForCity, getBaremeByCityIds, DEFAULTS, HORS_ZONE_TARIFS };
