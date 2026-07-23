const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity, listCities } = require('./_lib/city');
const { getAvailability } = require('./_lib/stock');
const { checkAdminToken } = require('./_lib/auth');
const { INCIDENT_OPEN_STATUSES } = require('./_lib/incidentStatus');
const { computeParcDashboard } = require('./_lib/parcDashboard');

function rangeStartISO(periode) {
  const d = new Date();
  if (periode === 'jour')      { d.setUTCHours(0, 0, 0, 0); }
  else if (periode === '30j')  { d.setUTCDate(d.getUTCDate() - 30); }
  else if (periode === 'mois') { d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); }
  else                         { d.setUTCDate(d.getUTCDate() - 7); } // '7j' par défaut
  return d.toISOString();
}

// Bornes [hier 00h, aujourd'hui 00h) — pour le résumé de performances de la
// veille affiché à la connexion.
function yesterdayRangeISO() {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0); start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
  return [start.toISOString(), end.toISOString()];
}

// Calcule les stats d'une seule ville — utilisé à la fois pour la vue
// "une ville" et pour chaque ligne de l'agrégat "toutes les villes".
async function computeCityStats(supabase, city, periode, since) {
  // 'confirmee' OU 'terminee' — une réservation passe à 'terminee' dès la
  // récupération effectuée (fin de location normale). Sur une période courte
  // (ex. "jour"/"7j"), une location déjà terminée créée dans la fenêtre
  // disparaissait purement et simplement du CA et du nombre de réservations
  // affichés — même défaut que ca_total_ville ci-dessous (voir
  // supabase/migration_ca_total_terminee.sql, à valider avant d'être collée
  // en base).
  const { data: resas, error: resaErr } = await supabase
    .from('reservations')
    .select('prix_total_cents')
    .eq('city_id', city.id)
    .in('statut', ['confirmee', 'terminee'])
    .gte('created_at', since);
  if (resaErr) throw resaErr;

  const caCents = (resas || []).reduce((sum, r) => sum + (r.prix_total_cents || 0), 0);

  // Somme calculée côté base (fonction SQL `ca_total_ville`, voir
  // supabase/migration_dashboard_ca_total.sql) plutôt que de télécharger une
  // ligne par réservation confirmée de tout l'historique de la ville — cette
  // requête est rejouée à chaque rafraîchissement automatique du tableau de
  // bord (toutes les 18s côté admin/index.html tant que l'onglet reste ouvert).
  const { data: caTotalCentsRaw, error: caTotalErr } = await supabase.rpc('ca_total_ville', { p_city_id: city.id });
  if (caTotalErr) throw caTotalErr;
  const caTotalCents = typeof caTotalCentsRaw === 'number' ? caTotalCentsRaw : 0;

  const { count: flotteTotale } = await supabase
    .from('appareils').select('id', { count: 'exact', head: true })
    .eq('city_id', city.id).not('statut', 'in', '(panne,maintenance)');

  const today    = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const disponibles = Math.max(0, await getAvailability(supabase, city.id, today, tomorrow));
  const occupees     = Math.max(0, (flotteTotale || 0) - disponibles);
  const tauxOccupation = flotteTotale > 0 ? occupees / flotteTotale : 0;

  const { count: incidentsOuverts } = await supabase
    .from('incidents').select('id', { count: 'exact', head: true }).eq('city_id', city.id).in('statut', INCIDENT_OPEN_STATUSES);
  const { count: incidentsPeriode } = await supabase
    .from('incidents').select('id', { count: 'exact', head: true }).eq('city_id', city.id).gte('created_at', since);

  const [hierStart, hierEnd] = yesterdayRangeISO();
  const { data: resasHier } = await supabase
    .from('reservations').select('prix_total_cents')
    .eq('city_id', city.id).in('statut', ['confirmee', 'terminee'])
    .gte('created_at', hierStart).lt('created_at', hierEnd);
  const caHierCents = (resasHier || []).reduce((sum, r) => sum + (r.prix_total_cents || 0), 0);

  // Filtre d'abord sur la journée d'hier (gte/lt sur fait_at) — livraisons n'a
  // pas de city_id direct, donc on rattache la ville via un inner join sur
  // reservations plutôt que de télécharger d'abord TOUS les ids de réservation
  // de la ville (potentiellement tout l'historique) pour filtrer dessus ensuite.
  const { count: missionsTermineesHierCount, error: missionsHierErr } = await supabase
    .from('livraisons')
    .select('id, reservation:reservations!inner(city_id)', { count: 'exact', head: true })
    .eq('reservation.city_id', city.id)
    .eq('statut', 'fait')
    .gte('fait_at', hierStart).lt('fait_at', hierEnd);
  if (missionsHierErr) throw missionsHierErr;
  const missionsTermineesHier = missionsTermineesHierCount || 0;
  const { count: incidentsHier } = await supabase
    .from('incidents').select('id', { count: 'exact', head: true })
    .eq('city_id', city.id).gte('created_at', hierStart).lt('created_at', hierEnd);

  // Bloc "Logistique" (Module 7, Bloc 5) : au-delà du seul résumé du jour
  // déjà affiché plus haut — missions en cours, terminées sur la période,
  // et en retard, tous types confondus (livraison/récupération/changement).
  const todayStr = new Date().toISOString().slice(0, 10);
  const { count: missionsEnCours } = await supabase
    .from('livraisons')
    .select('id, reservation:reservations!inner(city_id)', { count: 'exact', head: true })
    .eq('reservation.city_id', city.id)
    .in('statut', ['en_route', 'arrivee']);
  const { count: missionsTermineesPeriode } = await supabase
    .from('livraisons')
    .select('id, reservation:reservations!inner(city_id)', { count: 'exact', head: true })
    .eq('reservation.city_id', city.id)
    .eq('statut', 'fait').gte('fait_at', since);
  const { count: missionsEnRetard } = await supabase
    .from('livraisons')
    .select('id, reservation:reservations!inner(city_id)', { count: 'exact', head: true })
    .eq('reservation.city_id', city.id)
    .in('statut', ['a_faire', 'acceptee']).lt('date_prevue', todayStr);

  const parc = await computeParcDashboard(supabase, city.id);
  const nbResa = (resas || []).length;

  return {
    periode,
    ville:              city.name,
    city_id:            city.id,
    ca_euros:           caCents / 100,
    ca_total_euros:     caTotalCents / 100,
    nb_reservations:    nbResa,
    panier_moyen_euros: nbResa > 0 ? (caCents / 100) / nbResa : 0,
    flotte_totale:      flotteTotale || 0,
    unites_occupees:    occupees,
    taux_occupation:    tauxOccupation,
    parc,
    logistique: {
      missions_en_cours:          missionsEnCours || 0,
      missions_terminees_periode: missionsTermineesPeriode || 0,
      missions_en_retard:         missionsEnRetard || 0,
      problemes_signales:         incidentsOuverts || 0,
    },
    hier: {
      ca_euros:           caHierCents / 100,
      nb_reservations:    (resasHier || []).length,
      missions_terminees: missionsTermineesHier,
      incidents:          incidentsHier || 0,
    },
    incidents_ouverts:  incidentsOuverts || 0,
    incidents_periode:  incidentsPeriode || 0,
  };
}

// Bloc "Partenaires" (Module 7, Bloc 6) : global, pas par ville — un
// partenaire (conciergerie...) n'est pas une ressource opérationnelle
// localisée (voir admin-alerts.js, même choix pour partenaire_virements).
async function computePartenairesBlock(supabase, since) {
  const { count: partenairesActifs } = await supabase
    .from('partenaires').select('id', { count: 'exact', head: true }).eq('actif', true);
  const { count: commandesPeriode } = await supabase
    .from('reservations').select('id', { count: 'exact', head: true })
    .not('partenaire_id', 'is', null).gte('created_at', since);
  const { count: commissionsAValider } = await supabase
    .from('partenaire_virements').select('id', { count: 'exact', head: true }).eq('statut', 'demande');
  const { count: commissionsPayeesPeriode } = await supabase
    .from('partenaire_virements').select('id', { count: 'exact', head: true })
    .eq('statut', 'verse').gte('verse_at', since);
  return {
    partenaires_actifs:        partenairesActifs || 0,
    commandes_periode:         commandesPeriode || 0,
    commissions_a_valider:     commissionsAValider || 0,
    commissions_payees_periode: commissionsPayeesPeriode || 0,
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body    = req.body || {};
  const periode = body.periode || '7j';
  const since   = rangeStartISO(periode);

  try {
    // Tableau de bord principal : agrège toutes les villes actives, avec le
    // détail par ville pour la ligne de tableau — le sélecteur envoie
    // city_id:'all' quand aucune ville précise n'est choisie.
    if (body.city_id === 'all') {
      const cities = await listCities(supabase);
      // Chaque ville est indépendante (aucun état partagé entre itérations) —
      // on les calcule en parallèle plutôt qu'une par une, ce qui évite
      // d'attendre N fois la durée d'une seule ville pour N villes.
      const parVille = await Promise.all(
        cities.map(city => computeCityStats(supabase, city, periode, since))
      );
      const sum = (key) => parVille.reduce((s, v) => s + (v[key] || 0), 0);
      const sumHier = (key) => parVille.reduce((s, v) => s + (v.hier[key] || 0), 0);
      const sumParc = (key) => parVille.reduce((s, v) => s + (v.parc[key] || 0), 0);
      const sumLog  = (key) => parVille.reduce((s, v) => s + (v.logistique[key] || 0), 0);
      const nbResaTotal = sum('nb_reservations');
      const partenaires = await computePartenairesBlock(supabase, since);
      return res.status(200).json({
        periode,
        agregat: true,
        ca_euros:          sum('ca_euros'),
        ca_total_euros:    sum('ca_total_euros'),
        nb_reservations:   nbResaTotal,
        panier_moyen_euros: nbResaTotal > 0 ? sum('ca_euros') / nbResaTotal : 0,
        flotte_totale:     sum('flotte_totale'),
        unites_occupees:   sum('unites_occupees'),
        taux_occupation:   sum('flotte_totale') > 0 ? sum('unites_occupees') / sum('flotte_totale') : 0,
        parc: {
          total:          sumParc('total'),
          disponibles:    sumParc('disponibles'),
          en_location:    sumParc('en_location'),
          en_preparation: sumParc('en_preparation'),
          en_maintenance: sumParc('en_maintenance'),
          hors_service:   sumParc('hors_service'),
        },
        logistique: {
          missions_en_cours:          sumLog('missions_en_cours'),
          missions_terminees_periode: sumLog('missions_terminees_periode'),
          missions_en_retard:         sumLog('missions_en_retard'),
          problemes_signales:         sumLog('problemes_signales'),
        },
        partenaires,
        hier: {
          ca_euros:           sumHier('ca_euros'),
          nb_reservations:    sumHier('nb_reservations'),
          missions_terminees: sumHier('missions_terminees'),
          incidents:          sumHier('incidents'),
        },
        incidents_ouverts: sum('incidents_ouverts'),
        incidents_periode: sum('incidents_periode'),
        par_ville: parVille,
      });
    }

    const city = await resolveAdminCity(supabase, body);
    if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });
    const stats = await computeCityStats(supabase, city, periode, since);
    stats.partenaires = await computePartenairesBlock(supabase, since);
    return res.status(200).json(stats);
  } catch (err) {
    console.error('[Admin dashboard]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
