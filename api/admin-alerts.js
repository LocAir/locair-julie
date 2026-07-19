const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity } = require('./_lib/city');
const { checkAdminToken } = require('./_lib/auth');
const { INCIDENT_OPEN_STATUSES } = require('./_lib/incidentStatus');
const { buildCommunicationsCockpit } = require('./_lib/communicationsCockpit');

// Compte, par onglet, ce qui attend une action de l'admin — affiché en badge
// sur la barre latérale. Pensé pour être étendu facilement (nouvel onglet =
// une clé de plus dans la réponse) le jour où un espace client existera.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  try {
    const city = await resolveAdminCity(supabase, req.body);
    if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });

    const { data: cityTransp } = await supabase.from('transporteurs').select('id').eq('city_id', city.id);
    const transpIds = (cityTransp || []).map(t => t.id);
    let virements = 0;
    if (transpIds.length) {
      const { count } = await supabase
        .from('virements').select('id', { count: 'exact', head: true })
        .in('transporteur_id', transpIds).eq('statut', 'demande');
      virements = count || 0;
    }

    // Une réservation masquée (doublon retiré de l'écran par l'admin) ne doit
    // gonfler ni le badge "problèmes/non assignées" ni le bandeau permanent.
    const { data: cityResas } = await supabase.from('reservations').select('id').eq('city_id', city.id).eq('masquee', false);
    const resaIds = (cityResas || []).map(r => r.id);
    let livraisons = 0;
    let nonAssignees = 0;
    if (resaIds.length) {
      const { count: problemeCount } = await supabase
        .from('livraisons').select('id', { count: 'exact', head: true })
        .in('reservation_id', resaIds).eq('statut', 'probleme');
      // Le pire scénario opérationnel : une réservation confirmée dont les
      // missions n'ont encore aucun livreur assigné — sans ce compteur, rien
      // ne signale activement qu'un client attend une livraison non dispatchée.
      // Limité aux missions dues sous 72h (ou déjà en retard) : au-delà, ne
      // pas avoir encore assigné est normal (le dispatch se fait au fil de
      // l'eau) — tout compter en alerte permanente rendrait le signal
      // inutile, allumé en continu même quand rien n'est urgent.
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 3);
      const horizonStr = horizon.toISOString().slice(0, 10);
      const { count: nonAssigneesCount } = await supabase
        .from('livraisons').select('id', { count: 'exact', head: true })
        .in('reservation_id', resaIds).eq('statut', 'a_faire').is('transporteur_id', null)
        .lte('date_prevue', horizonStr);
      livraisons = (problemeCount || 0) + (nonAssigneesCount || 0);
      nonAssignees = nonAssigneesCount || 0;
    }

    // Réservations nécessitant une action :
    //  — en_attente : paiement reçu mais pas encore confirmé par le webhook
    //    (rare, mais si ça traîne l'admin doit regarder)
    //  — hors_zone : code postal non couvert, affectation manuelle requise —
    //    mais seulement tant qu'il reste vraiment une mission sans livreur.
    //    Le drapeau hors_zone ne s'efface jamais une fois posé (c'est un fait
    //    géographique, pas un statut) : compter juste "hors_zone=true" gonfle
    //    ce badge pour toujours, même après affectation manuelle du livreur —
    //    exactement le genre de notification bloquée signalé pour les
    //    virements. On revérifie donc s'il reste une mission "à faire" sans
    //    transporteur, comme pour le compteur "non assignées" ci-dessus.
    const { count: enAttenteCount } = await supabase
      .from('reservations').select('id', { count: 'exact', head: true })
      .eq('city_id', city.id).eq('statut', 'en_attente').eq('masquee', false);
    const { data: horsZoneResas } = await supabase
      .from('reservations').select('id')
      .eq('city_id', city.id).eq('hors_zone', true).eq('masquee', false)
      .neq('statut', 'annulee');
    const horsZoneIds = (horsZoneResas || []).map(r => r.id);
    let horsZoneCount = 0;
    if (horsZoneIds.length) {
      const { data: horsZoneNonAssignees } = await supabase
        .from('livraisons').select('reservation_id')
        .in('reservation_id', horsZoneIds).eq('statut', 'a_faire').is('transporteur_id', null);
      horsZoneCount = new Set((horsZoneNonAssignees || []).map(l => l.reservation_id)).size;
    }
    const reservations = (enAttenteCount || 0) + horsZoneCount;

    // Incidents ouverts (non résolus) — signal fort : chaque incident signifie
    // un livreur bloqué ou un client mécontent qui attend un retour de l'admin.
    const { count: incidentsCount } = await supabase
      .from('incidents').select('id', { count: 'exact', head: true })
      .in('reservation_id', resaIds).in('statut', INCIDENT_OPEN_STATUSES);
    const incidents = incidentsCount || 0;

    // Missions en retard, tous types confondus (livraison, récupération,
    // changement) : date_prevue dépassée, mission pas encore faite. Une
    // livraison ou un remplacement en retard laisse un client sans clim —
    // au moins aussi urgent qu'une récupération en retard (appareil bloqué
    // chez le client) — donc pas de restriction de type ici : l'onglet
    // Livraisons a lui-même un filtre "En retard" tous types confondus,
    // ce compteur doit correspondre exactement à ce qu'il affiche.
    const todayStr = new Date().toISOString().slice(0, 10);
    const { count: retardsCount } = await supabase
      .from('livraisons').select('id', { count: 'exact', head: true })
      .in('reservation_id', resaIds)
      .in('statut', ['a_faire', 'acceptee'])
      .lt('date_prevue', todayStr);
    const retards = retardsCount || 0;

    // Demandes de virement partenaire — pas de rattachement par ville (un
    // partenaire n'est pas une ressource opérationnelle localisée), donc
    // compté globalement plutôt que via cityTransp comme pour les transporteurs.
    const { count: partenaireVirementsCount } = await supabase
      .from('partenaire_virements').select('id', { count: 'exact', head: true }).eq('statut', 'demande');

    // Réconciliation : commission déjà versée à un partenaire pour une
    // réservation ensuite annulée/remboursée — signalé jusqu'à ce que l'admin
    // marque le litige réglé (voir migration_partenaires_litiges.sql).
    const { count: partenaireLitigesCount } = await supabase
      .from('reservations').select('id', { count: 'exact', head: true })
      .in('statut', ['annulee', 'remboursee']).eq('partenaire_commission_payee', true).eq('partenaire_litige_resolu', false);

    // Catégorie "Stock" (Module 7, Partie 26) : climatiseurs en panne ou en
    // maintenance — jusqu'ici la seule catégorie du centre d'alertes du
    // module qui n'avait pas d'équivalent ici (les autres existaient déjà
    // sous forme de compteurs, voir ci-dessus).
    const { count: stockIndispoCount } = await supabase
      .from('appareils').select('id', { count: 'exact', head: true })
      .eq('city_id', city.id).in('statut', ['panne', 'maintenance']);
    const stockIndispo = stockIndispoCount || 0;

    // Panneau Communications : email/SMS jamais parti alors qu'il aurait dû,
    // ou dernier envoi en erreur — même définition d'anomalie que le
    // panneau détaillé (voir _lib/communicationsCockpit.js), pour que ce
    // badge ne raconte jamais une histoire différente de celle du panneau.
    let communications = 0;
    try {
      communications = (await buildCommunicationsCockpit(supabase, city.id)).anomalies;
    } catch (e) {
      console.error('[Admin alerts] communications', e.message);
    }

    return res.status(200).json({
      virements, livraisons, non_assignees: nonAssignees, reservations, incidents, retards,
      partenaire_virements: partenaireVirementsCount || 0,
      partenaire_litiges: partenaireLitigesCount || 0,
      stock_indisponible: stockIndispo,
      communications,
    });
  } catch (err) {
    console.error('[Admin alerts]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
