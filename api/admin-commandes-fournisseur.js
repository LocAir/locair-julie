const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity } = require('./_lib/city');
const { checkAdminToken } = require('./_lib/auth');

// Suivi des commandes fournisseurs (Module 8) — la prévision de demande
// (api/admin-dashboard.js, action 'previsions') dit "il faut racheter du
// stock", mais jusqu'ici rien ne suivait si la commande a été passée,
// combien d'appareils arrivent et quand. Reste un simple suivi d'achat/
// budget : "Marquer livrée" ne crée jamais d'appareils automatiquement —
// l'admin les ajoute ensuite via le flux existant (admin-stock.js, action
// 'add'), une fois physiquement réceptionnés et vérifiés.
const STATUTS_VALIDES = ['commande', 'en_transit', 'livree', 'annulee'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    const city = await resolveAdminCity(supabase, body);
    if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });

    if (action === 'list') {
      const { data, error } = await supabase
        .from('commandes_fournisseur')
        .select('id, fournisseur, quantite, montant_cents, date_commande, date_livraison_prevue, date_livraison_reelle, statut, notes, created_at')
        .eq('city_id', city.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return res.status(200).json({ commandes: data || [] });
    }

    if (action === 'create') {
      const fournisseur = (body.fournisseur || '').trim().slice(0, 200);
      const quantite = parseInt(body.quantite);
      if (!fournisseur) return res.status(400).json({ error: 'Fournisseur requis' });
      if (!Number.isFinite(quantite) || quantite <= 0) return res.status(400).json({ error: 'Quantité invalide' });

      const montantCents = parseInt(body.montant_cents);
      const insertRow = {
        city_id: city.id,
        fournisseur,
        quantite,
        statut: 'commande',
        montant_cents: Number.isFinite(montantCents) && montantCents >= 0 ? montantCents : 0,
        date_livraison_prevue: body.date_livraison_prevue || null,
        notes: (body.notes || '').slice(0, 1000) || null,
      };
      if (body.date_commande) insertRow.date_commande = body.date_commande;

      const { data, error } = await supabase.from('commandes_fournisseur').insert(insertRow).select().single();
      if (error) throw error;
      return res.status(200).json({ ok: true, commande: data });
    }

    if (action === 'update_statut') {
      const id = parseInt(body.id);
      if (!id || !body.statut) return res.status(400).json({ error: 'Paramètres manquants' });
      if (!STATUTS_VALIDES.includes(body.statut)) return res.status(400).json({ error: 'Statut invalide' });
      const { data: before } = await supabase
        .from('commandes_fournisseur').select('id, city_id')
        .eq('id', id).maybeSingle();
      if (!before || before.city_id !== city.id) return res.status(404).json({ error: 'Commande introuvable' });

      const patch = { statut: body.statut };
      if (body.statut === 'livree') patch.date_livraison_reelle = new Date().toISOString().slice(0, 10);
      const { error } = await supabase.from('commandes_fournisseur').update(patch).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin commandes fournisseur]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
