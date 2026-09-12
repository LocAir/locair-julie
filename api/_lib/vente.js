// Les modèles proposés à la VENTE — voir migration_vente_catalogue.sql.
// Rien à voir avec le parc de location : ce sont des machines neuves
// commandées pour être revendues. Un appareil de la table `appareils` ne
// passe jamais par ici (celui-là se vend d'occasion, au cas par cas, via
// l'Offre Privilège).
//
// RÈGLE DE SURVIE : aucune de ces fonctions ne jette jamais.
// La migration n'est peut-être pas encore appliquée en production — dans ce
// cas Supabase renvoie une erreur « column does not exist » et on répond
// une liste vide, exactement comme s'il n'y avait rien à vendre. La page
// d'achat retombe alors sur « demander le prix », son comportement d'avant.
// C'est la même prudence que _lib/forfaits.js, et pour la même raison : du
// code déployé plus vite qu'une migration a déjà cassé la production.

const CHAMPS = [
  'id', 'marque', 'modele', 'puissance_btu', 'surface_max_m2',
  'niveau_sonore_db', 'classe_energie', 'photo_url', 'documentation_url',
  'prix_vente_cents', 'stock_vente', 'delai_vente_jours',
  'garantie_fabricant_mois', 'installation_vente_cents',
].join(', ');

// Une colonne peut manquer sans que Supabase ne renvoie d'erreur (migration
// collée en deux fois, par exemple) : la ligne arrive alors sans le champ.
// Sans ce contrôle, un prix undefined se propage en « NaN € » jusqu'à la
// page. Même garde que isCompleteForfaitRow().
function ligneComplete(m) {
  return m
    && typeof m.marque === 'string' && m.marque.trim()
    && typeof m.modele === 'string' && m.modele.trim()
    && Number.isFinite(m.prix_vente_cents) && m.prix_vente_cents > 0
    && Number.isFinite(m.stock_vente) && m.stock_vente > 0;
}

// Ce que le SITE a le droit de lire : uniquement ce qui est réellement
// vendable aujourd'hui. Le stock n'est jamais publié tel quel — savoir
// qu'il en reste douze n'aide personne à décider, et le publier renseigne
// surtout la concurrence. On ne dit que « disponible » ou rien.
async function getProduitsVente(supabase) {
  try {
    const { data, error } = await supabase
      .from('modeles_climatiseur').select(CHAMPS)
      .eq('actif', true).eq('vente_active', true)
      .order('prix_vente_cents', { ascending: true });
    if (error) return [];
    return (data || []).filter(ligneComplete).map((m) => ({
      id: m.id,
      marque: m.marque,
      modele: m.modele,
      puissance_btu: m.puissance_btu || null,
      surface_max_m2: m.surface_max_m2 || null,
      niveau_sonore_db: m.niveau_sonore_db || null,
      classe_energie: m.classe_energie || null,
      photo_url: m.photo_url || null,
      documentation_url: m.documentation_url || null,
      prix_vente_cents: m.prix_vente_cents,
      delai_vente_jours: Number.isFinite(m.delai_vente_jours) ? m.delai_vente_jours : null,
      garantie_fabricant_mois: Number.isFinite(m.garantie_fabricant_mois) ? m.garantie_fabricant_mois : null,
      installation_vente_cents: Number.isFinite(m.installation_vente_cents) ? m.installation_vente_cents : null,
    }));
  } catch (e) {
    console.error('[vente] getProduitsVente:', e.message);
    return [];
  }
}

// Pour l'ADMIN : tout le catalogue, vendable ou non, avec le stock. Renvoie
// aussi si la migration est passée — l'onglet Vente a besoin de faire la
// différence entre « rien à vendre » et « les colonnes n'existent pas
// encore », qui demandent deux messages très différents.
async function getCatalogueAdmin(supabase) {
  try {
    const { data, error } = await supabase
      .from('modeles_climatiseur').select(CHAMPS + ', actif')
      .order('marque').order('modele');
    if (error) {
      const manque = /column|does not exist|schema cache/i.test(error.message || '');
      return { migration: !manque, modeles: [], erreur: error.message };
    }
    return { migration: true, modeles: data || [] };
  } catch (e) {
    console.error('[vente] getCatalogueAdmin:', e.message);
    return { migration: true, modeles: [], erreur: e.message };
  }
}

module.exports = { getProduitsVente, getCatalogueAdmin };
