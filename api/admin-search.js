const { getSupabase } = require('./_lib/supabase');
const { checkAdminToken } = require('./_lib/auth');

const LIMIT = 8;

// Recherche globale (Module 7, Partie 4) : une seule barre pour retrouver
// un client/une commande/un climatiseur/un transporteur/un partenaire, sans
// naviguer d'onglet en onglet. Cherche dans TOUTES les villes (contrairement
// au reste de l'admin, scopé à la ville sélectionnée) — retrouver un client
// ne doit pas dépendre de la ville actuellement affichée.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const q = ((req.body || {}).q || '').trim().slice(0, 100);
  if (q.length < 2) {
    return res.status(200).json({ commandes: [], clients: [], climatiseurs: [], transporteurs: [], partenaires: [] });
  }

  const like = `%${q}%`;
  const numero = parseInt(q, 10);

  try {
    const [
      { data: commandes },
      { data: clients },
      { data: climatiseurs },
      { data: transporteurs },
      { data: partenaires },
    ] = await Promise.all([
      supabase.from('reservations')
        .select('id, ref, prenom, nom, statut, date_debut, date_fin, city_id')
        .or(`ref.ilike.${like},prenom.ilike.${like},nom.ilike.${like},email.ilike.${like},tel.ilike.${like}`)
        .order('created_at', { ascending: false }).limit(LIMIT),
      supabase.from('clients')
        .select('id, prenom, nom, email, tel, city_id')
        .or(`prenom.ilike.${like},nom.ilike.${like},email.ilike.${like},tel.ilike.${like}`)
        .limit(LIMIT),
      Number.isFinite(numero)
        ? supabase.from('appareils').select('id, numero, statut, reference, city_id').or(`numero.eq.${numero},reference.ilike.${like}`).limit(LIMIT)
        : supabase.from('appareils').select('id, numero, statut, reference, city_id').ilike('reference', like).limit(LIMIT),
      supabase.from('transporteurs').select('id, nom, actif, en_pause, telephone, city_id').ilike('nom', like).limit(LIMIT),
      supabase.from('partenaires').select('id, nom, actif').ilike('nom', like).limit(LIMIT),
    ]);

    return res.status(200).json({
      commandes:     commandes || [],
      clients:       clients || [],
      climatiseurs:  climatiseurs || [],
      transporteurs: transporteurs || [],
      partenaires:   partenaires || [],
    });
  } catch (err) {
    console.error('[Admin search]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
