const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');

const CATEGORIES = ['bienvenue', 'parrainage', 'fidelite', 'dormant', 'saisonnier', 'flash', 'partenaire', 'cadeau', 'groupe', 'autre'];

// Panneau de contrôle des offres/codes promo — remplace les codes en dur
// dans checkout.js et les pourcentages fixes de _lib/promo.js (voir
// _lib/promotions.js pour le calcul réel appliqué au paiement). Avant ça,
// changer ou ajouter un code promo voulait dire modifier le code et
// redéployer — désormais ça se fait depuis cet écran, sans jamais toucher
// au site.
function toIntOrNull(v) {
  if (v === '' || v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
function toDateOrNull(v) {
  const s = (v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    if (action === 'list') {
      // Lecture accessible à tout compte connecté (comme les tarifs et les
      // villes) — seule la création/modification est réservée aux comptes
      // ayant accès aux réglages.
      const { data, error } = await supabase.from('promotions').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ promotions: data || [] });
    }

    if (!roleHasAccess(admin.role, 'reglages')) return res.status(403).json({ error: "Ton compte n'a pas accès aux réglages." });

    if (action === 'create' || action === 'update') {
      const nom = (body.nom || '').trim();
      if (!nom) return res.status(400).json({ error: 'Nom requis' });

      const categorie = CATEGORIES.includes(body.categorie) ? body.categorie : 'autre';
      const typeRemise = body.type_remise;
      if (!['pourcentage', 'montant_fixe'].includes(typeRemise)) {
        return res.status(400).json({ error: 'Type de remise invalide' });
      }
      const valeur = parseFloat(body.valeur);
      if (!Number.isFinite(valeur) || valeur <= 0) {
        return res.status(400).json({ error: 'La valeur de la remise doit être un nombre positif' });
      }
      if (typeRemise === 'pourcentage' && valeur > 100) {
        return res.status(400).json({ error: 'Un pourcentage ne peut pas dépasser 100' });
      }
      // Un code est obligatoire pour l'instant : le site ne sait vérifier
      // une offre qu'à partir du code saisi par le client (checkout.js) —
      // une offre sans code serait créée mais n'aurait jamais d'effet, ce
      // qui donnerait l'illusion trompeuse qu'elle s'applique. Les remises
      // "automatiques, sans code, visibles direct sur le site" sont une
      // extension possible plus tard (pas encore construite).
      const code = (body.code || '').trim().toUpperCase().slice(0, 50);
      if (!code) return res.status(400).json({ error: 'Un code promo est requis pour le moment (les remises automatiques sans code arriveront plus tard).' });
      const dateDebut = toDateOrNull(body.date_debut);
      const dateFin   = toDateOrNull(body.date_fin);
      if (dateDebut && dateFin && dateDebut > dateFin) {
        return res.status(400).json({ error: 'La date de début doit précéder la date de fin' });
      }
      const dureeMin = toIntOrNull(body.duree_min_jours);
      const dureeMax = toIntOrNull(body.duree_max_jours);
      if (dureeMin != null && dureeMax != null && dureeMin > dureeMax) {
        return res.status(400).json({ error: 'La durée minimale doit être inférieure ou égale à la durée maximale' });
      }
      const maxUtilisations       = toIntOrNull(body.max_utilisations);
      const maxUtilisationsClient = toIntOrNull(body.max_utilisations_client);
      const villesIds = Array.isArray(body.villes_ids) ? body.villes_ids.map(v => parseInt(v, 10)).filter(Number.isFinite) : [];
      const premiereResaOnly = body.premiere_resa_only === true;
      const actif = body.actif !== false;

      const patch = {
        nom, categorie, code, type_remise: typeRemise, valeur,
        date_debut: dateDebut, date_fin: dateFin,
        duree_min_jours: dureeMin, duree_max_jours: dureeMax,
        premiere_resa_only: premiereResaOnly,
        max_utilisations: maxUtilisations, max_utilisations_client: maxUtilisationsClient,
        villes_ids: villesIds.length ? villesIds : null,
        actif,
      };

      if (action === 'create') {
        const { error } = await supabase.from('promotions').insert(patch);
        if (error) {
          if (error.code === '23505') return res.status(409).json({ error: 'Une offre avec ce code existe déjà' });
          throw error;
        }
        return res.status(200).json({ ok: true });
      }

      const id = parseInt(body.id, 10);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { error } = await supabase.from('promotions').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Une offre avec ce code existe déjà' });
        throw error;
      }
      return res.status(200).json({ ok: true });
    }

    // Coupe une offre sans la supprimer (garde l'historique d'utilisation) —
    // c'est le geste normal pour arrêter une promo, "delete" reste réservé à
    // une erreur de saisie.
    if (action === 'toggle') {
      const id = parseInt(body.id, 10);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { error } = await supabase.from('promotions').update({ actif: body.actif === true, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete') {
      const id = parseInt(body.id, 10);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { error } = await supabase.from('promotions').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin promotions]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
