// Packs à prix fixe (ex. "Pack Sérénité Solo/Duo") — voir
// migration_forfaits.sql. Contrairement au tarif dégressif (pricing.js) ou
// à une remise en % (promotions.js), un forfait a un prix TOTAL figé pour
// une durée et une quantité précises : il ne bouge jamais, même si le
// barème normal change ensuite.

// Une ligne existe mais une colonne numérique manque (migration collée en
// plusieurs fois...) : Supabase ne renvoie aucune erreur dans ce cas —
// juste la ligne sans le champ. Sans ce contrôle, un prix ou une durée
// undefined se propage en NaN jusqu'au montant Stripe (checkout.js) ou à
// un "NaN €" affiché sur le site/dans un PDF.
function isCompleteForfaitRow(row) {
  return row
    && Number.isFinite(row.quantite) && row.quantite > 0
    && Number.isFinite(row.duree_jours) && row.duree_jours > 0
    && Number.isFinite(row.prix_cents) && row.prix_cents > 0;
}

async function getActiveForfaits(supabase) {
  try {
    const { data, error } = await supabase.from('forfaits').select('*').eq('actif', true).order('quantite');
    if (error) return [];
    return (data || []).filter(isCompleteForfaitRow);
  } catch (e) {
    console.error('[forfaits] getActiveForfaits:', e.message);
    return [];
  }
}

// Renvoie le forfait uniquement s'il est actif ET que la durée/quantité
// demandées correspondent exactement — sinon null. Ne jette jamais : un
// forfait qu'on ne retrouve plus doit juste faire retomber le checkout sur
// le tarif dégressif normal, jamais bloquer un paiement.
async function getMatchingForfait(supabase, { forfaitId, duree, quantite }) {
  if (!forfaitId) return null;
  try {
    const { data, error } = await supabase.from('forfaits').select('*').eq('id', forfaitId).eq('actif', true).maybeSingle();
    if (error || !isCompleteForfaitRow(data)) return null;
    if (data.duree_jours !== duree || data.quantite !== quantite) return null;
    return data;
  } catch (e) {
    console.error('[forfaits] getMatchingForfait:', e.message);
    return null;
  }
}

// Relit un forfait par id tel qu'il était (pas de filtre "actif" : sert à
// documenter après coup — contrat/facture — une réservation déjà payée,
// même si le pack a depuis été désactivé ou supprimé côté admin). Ne jette
// jamais : un document généré sans le détail du pack reste préférable à un
// document qui ne se génère pas du tout. Une ligne incomplète est traitée
// comme absente (le PDF retombe alors sur le libellé générique, voir
// _lib/pdf.js), plutôt que d'afficher un "NaN €" dans un contrat signé.
async function getForfaitById(supabase, id) {
  if (!id) return null;
  try {
    const { data, error } = await supabase.from('forfaits').select('*').eq('id', id).maybeSingle();
    if (error || !isCompleteForfaitRow(data)) return null;
    return data;
  } catch (e) {
    console.error('[forfaits] getForfaitById:', e.message);
    return null;
  }
}

module.exports = { getActiveForfaits, getMatchingForfait, getForfaitById };
