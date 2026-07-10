const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity } = require('./_lib/city');
const { checkAdminToken } = require('./_lib/auth');

// La table incidents est alimentée automatiquement à chaque problème signalé
// par un livreur (client absent, appareil en panne, retard...) mais n'avait
// jusqu'ici aucune vue admin pour la consulter dans le temps — seulement des
// compteurs sur le dashboard. Cet endpoint expose l'historique complet pour
// repérer les motifs récurrents (ex. un digicode qui pose systématiquement
// problème à la même adresse).
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
      // Un incident sans réservation retrouvée (voir charge-retard.js) n'a pas
      // de city_id connu — plutôt que de le rendre invisible partout, il
      // s'affiche dans toutes les vues plutôt que d'être perdu.
      const { data, error } = await supabase
        .from('incidents')
        .select('id, type, description, montant_facture_cents, statut, created_at, reservation:reservations ( id, ref, prenom, nom, adresse )')
        .or(`city_id.eq.${city.id},city_id.is.null`)
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;

      const since30j = new Date(Date.now() - 30 * 86400000).toISOString();
      const parMois = { retard: 0, materiel: 0, autre: 0 };
      (data || []).forEach(i => { if (i.created_at >= since30j && parMois[i.type] != null) parMois[i.type]++; });

      return res.status(200).json({ incidents: data || [], par_type_30j: parMois });
    }

    if (action === 'update') {
      const id = parseInt(body.id);
      if (!id || !body.statut) return res.status(400).json({ error: 'Paramètres manquants' });
      const { data: before } = await supabase
        .from('incidents').select('id, city_id')
        .eq('id', id).maybeSingle();
      if (!before || (before.city_id !== null && before.city_id !== city.id)) return res.status(404).json({ error: 'Incident introuvable' });
      const { error } = await supabase.from('incidents').update({ statut: body.statut }).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin incidents]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
