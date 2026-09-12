const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');
const { getCatalogueAdmin } = require('./_lib/vente');

// Onglet « Vente » de l'admin — voir migration_vente_catalogue.sql.
// On ne crée ni ne supprime rien ici : les modèles viennent du catalogue
// existant (modeles_climatiseur), celui qui alimente déjà « Mon
// climatiseur » dans l'espace client. Cet écran ne fait qu'une chose :
// décider lesquels sont à vendre, et à quel prix.
//
// Lecture ouverte à tout compte connecté (comme Tarifs et Forfaits), écriture
// réservée aux comptes qui ont accès aux réglages.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    if (action === 'list') {
      // getCatalogueAdmin ne jette jamais et dit si la migration est passée :
      // l'écran doit pouvoir afficher « colle d'abord ce SQL » plutôt qu'une
      // erreur 500 incompréhensible.
      const { migration, modeles } = await getCatalogueAdmin(supabase);
      return res.status(200).json({ migration, modeles });
    }

    if (!roleHasAccess(admin.role, 'reglages')) {
      return res.status(403).json({ error: "Ton compte n'a pas accès aux réglages." });
    }

    if (action === 'update') {
      const id = parseInt(body.id, 10);
      if (!id) return res.status(400).json({ error: 'id manquant' });

      // Chaque champ est vérifié séparément. Un champ vide veut dire « pas
      // renseigné » (null), pas « zéro » : un délai de 0 jour et un délai
      // inconnu ne disent pas du tout la même chose au visiteur.
      const patch = {};

      if (body.vente_active !== undefined) patch.vente_active = body.vente_active === true;

      if (body.prix !== undefined) {
        const v = String(body.prix).trim();
        if (v === '') patch.prix_vente_cents = null;
        else {
          const cents = Math.round(parseFloat(v.replace(',', '.')) * 100);
          if (!Number.isFinite(cents) || cents <= 0) {
            return res.status(400).json({ error: 'Le prix de vente doit être un nombre positif.' });
          }
          patch.prix_vente_cents = cents;
        }
      }

      if (body.stock !== undefined) {
        const n = parseInt(body.stock, 10);
        if (!Number.isFinite(n) || n < 0 || n > 999) {
          return res.status(400).json({ error: 'Le stock doit être un nombre entre 0 et 999.' });
        }
        patch.stock_vente = n;
      }

      if (body.delai !== undefined) {
        const v = String(body.delai).trim();
        if (v === '') patch.delai_vente_jours = null;
        else {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n < 0 || n > 365) {
            return res.status(400).json({ error: 'Le délai doit être un nombre de jours entre 0 et 365.' });
          }
          patch.delai_vente_jours = n;
        }
      }

      if (body.garantie !== undefined) {
        const v = String(body.garantie).trim();
        if (v === '') patch.garantie_fabricant_mois = null;
        else {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n < 0 || n > 240) {
            return res.status(400).json({ error: 'La garantie doit être un nombre de mois entre 0 et 240.' });
          }
          patch.garantie_fabricant_mois = n;
        }
      }

      if (body.installation !== undefined) {
        const v = String(body.installation).trim();
        if (v === '') patch.installation_vente_cents = null;
        else {
          const cents = Math.round(parseFloat(v.replace(',', '.')) * 100);
          if (!Number.isFinite(cents) || cents < 0) {
            return res.status(400).json({ error: "Le prix de l'installation doit être 0 ou un nombre positif." });
          }
          patch.installation_vente_cents = cents;
        }
      }

      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Rien à enregistrer' });

      // Garde-fou : on ne met pas en vente un modèle sans prix. Sans ça, la
      // page publique filtrerait la ligne en silence et l'admin croirait
      // avoir publié quelque chose qui ne s'affiche nulle part.
      if (patch.vente_active === true) {
        const { data: actuel } = await supabase
          .from('modeles_climatiseur').select('prix_vente_cents, stock_vente').eq('id', id).maybeSingle();
        const prix  = patch.prix_vente_cents  !== undefined ? patch.prix_vente_cents  : (actuel || {}).prix_vente_cents;
        const stock = patch.stock_vente       !== undefined ? patch.stock_vente       : (actuel || {}).stock_vente;
        if (!Number.isFinite(prix) || prix <= 0) {
          return res.status(400).json({ error: 'Renseigne un prix de vente avant de mettre ce modèle en vente.' });
        }
        if (!Number.isFinite(stock) || stock <= 0) {
          return res.status(400).json({ error: 'Renseigne un stock avant de mettre ce modèle en vente.' });
        }
      }

      const { error } = await supabase.from('modeles_climatiseur').update(patch).eq('id', id);
      if (error) {
        // Le cas le plus probable en production : le SQL n'a pas encore été
        // collé. On le dit en clair plutôt que de renvoyer « Erreur serveur ».
        if (/column|does not exist|schema cache/i.test(error.message || '')) {
          return res.status(409).json({ error: 'La migration migration_vente_catalogue.sql n’a pas encore été appliquée dans Supabase.' });
        }
        throw error;
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin produits-vente]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
