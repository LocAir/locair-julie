const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');

// "Mes missions" (Module 5, Partie 10) : historique filtrable + statistiques
// d'activité, calculées depuis les données réelles (aucune table dédiée).
const FILTRES = {
  terminees:      (q) => q.eq('statut', 'fait'),
  en_attente:     (q) => q.in('statut', ['a_faire', 'acceptee', 'en_route', 'arrivee']),
  annulees:       (q) => q.in('statut', ['refusee', 'annule']),
  avec_incident:  (q) => q.not('incident_id', 'is', null),
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const transporteurId = await verifyTransporteurToken(req, supabase);
  if (!transporteurId) return res.status(401).json({ error: 'Session invalide' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    if (action === 'list') {
      const filtre = FILTRES[body.filtre] ? body.filtre : 'terminees';
      let query = supabase
        .from('livraisons')
        .select(`
          id, type, statut, date_prevue, creneau, montant_du_cents, incident_id, fait_at, probleme_type,
          reservation:reservations ( ref, prenom, nom, adresse ),
          appareils:reservation_appareils ( appareil:appareils ( numero ) )
        `)
        .eq('transporteur_id', transporteurId)
        .eq('masquee', false)
        .order('date_prevue', { ascending: false })
        .limit(200);
      query = FILTRES[filtre](query);
      const { data, error } = await query;
      if (error) throw error;

      const missions = (data || []).map(l => ({
        id: l.id, type: l.type, statut: l.statut, date_prevue: l.date_prevue, creneau: l.creneau,
        montant_cents: l.montant_du_cents || 0, fait_at: l.fait_at,
        avec_incident: Boolean(l.incident_id),
        // Motif du problème signalé, pour que le livreur voie tout de suite
        // ce qui s'est passé sans avoir à rouvrir une mission qui, une fois
        // annulée/refusée, ne fait plus forcément partie de ses missions
        // actives (transporteur-missions.js ne renvoie pas ce statut-là).
        probleme_type: l.probleme_type || null,
        adresse: l.reservation?.adresse || null,
        client: [l.reservation?.prenom, l.reservation?.nom].filter(Boolean).join(' ') || null,
      }));
      return res.status(200).json({ missions });
    }

    if (action === 'stats') {
      const { data, error } = await supabase
        .from('livraisons')
        .select('type, statut, montant_du_cents, incident_id')
        .eq('transporteur_id', transporteurId).eq('masquee', false)
        .in('statut', ['fait', 'refusee', 'annule', 'probleme']);
      if (error) throw error;

      const rows = data || [];
      const missionsRealisees = rows.filter(r => r.statut === 'fait').length;
      const livraisons        = rows.filter(r => r.statut === 'fait' && r.type === 'livraison').length;
      const recuperations     = rows.filter(r => r.statut === 'fait' && r.type === 'recuperation').length;
      const avecIncident      = rows.filter(r => r.incident_id != null).length;
      const remunerationCents = rows.filter(r => r.statut === 'fait').reduce((s, r) => s + (r.montant_du_cents || 0), 0);
      const tauxIncidents     = rows.length ? avecIncident / rows.length : 0;

      return res.status(200).json({
        missions_realisees: missionsRealisees,
        livraisons, recuperations,
        taux_incidents: tauxIncidents,
        remuneration_cumulee_euros: remunerationCents / 100,
      });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Transporteur history]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
