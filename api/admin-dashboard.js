const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity, listCities } = require('./_lib/city');
const { getAvailability } = require('./_lib/stock');
const { checkAdminToken, checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');
const { INCIDENT_OPEN_STATUSES } = require('./_lib/incidentStatus');
const { computeParcDashboard } = require('./_lib/parcDashboard');
const { isValidDate, addDays, todayParis } = require('./_lib/dates');

// Export comptable (Module 8) — un CA agrégé n'existe nulle part ailleurs
// dans le code : ca_total_ville (RPC) et ca_euros (computeCityStats
// ci-dessus) répondent à des besoins d'affichage ponctuel, pas à un export
// ligne par ligne pour un comptable. Filtre volontairement identique à
// computeCityStats ('confirmee'/'terminee') pour rester cohérent avec ce
// que le dashboard affiche déjà — et volontairement indépendant du RPC
// ca_total_ville dont on ne sait pas avec certitude quelle version est
// appliquée en base (voir supabase/migration_ca_total_terminee.sql).
async function computeExportComptable(supabase, cityIds, dateDebut, dateFin) {
  const { data: resas, error: resaErr } = await supabase
    .from('reservations')
    .select('id, ref, prenom, nom, email, created_at, prix_total_cents, partenaire_commission_cents')
    .in('city_id', cityIds)
    .in('statut', ['confirmee', 'terminee'])
    .gte('created_at', dateDebut + 'T00:00:00.000Z')
    .lt('created_at', addDays(dateFin, 1) + 'T00:00:00.000Z')
    .order('created_at', { ascending: true });
  if (resaErr) throw resaErr;

  const resaIds = (resas || []).map(r => r.id);
  const { data: rembs, error: rembErr } = resaIds.length
    ? await supabase.from('remboursements').select('reservation_id, montant_cents').in('reservation_id', resaIds)
    : { data: [], error: null };
  if (rembErr) throw rembErr;
  const rembByResa = {};
  (rembs || []).forEach(r => { rembByResa[r.reservation_id] = (rembByResa[r.reservation_id] || 0) + (r.montant_cents || 0); });

  const eur = (cents) => (cents / 100).toFixed(2);
  let totalTtc = 0, totalRembourse = 0, totalCommission = 0, totalNet = 0;
  const lignes = (resas || []).map(r => {
    const ttcCents = r.prix_total_cents || 0;
    const rembCents = rembByResa[r.id] || 0;
    const commissionCents = r.partenaire_commission_cents || 0;
    const netCents = ttcCents - rembCents - commissionCents;
    totalTtc += ttcCents; totalRembourse += rembCents; totalCommission += commissionCents; totalNet += netCents;
    return {
      ref: r.ref,
      date: (r.created_at || '').slice(0, 10),
      client: [r.prenom, r.nom].filter(Boolean).join(' ') || r.email || '',
      montant_ttc_euros: eur(ttcCents),
      rembourse_euros: eur(rembCents),
      commission_partenaire_euros: eur(commissionCents),
      net_euros: eur(netCents),
    };
  });

  return {
    lignes,
    totaux: {
      montant_ttc_euros: eur(totalTtc),
      rembourse_euros: eur(totalRembourse),
      commission_partenaire_euros: eur(totalCommission),
      net_euros: eur(totalNet),
    },
  };
}

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
  const [hierStart, hierEnd] = yesterdayRangeISO();
  const todayStr = todayParis();

  // Toutes les requêtes ci-dessous sont indépendantes (aucune ne dépend du
  // résultat d'une autre) — elles s'enchaînaient une par une, ce qui
  // multipliait le temps d'attente par le nombre de requêtes à chaque appel.
  // Un seul Promise.all n'attend que la plus lente des 11, au lieu de la
  // somme des 11 — sensible ici car cette fonction est rejouée à chaque
  // rafraîchissement automatique du tableau de bord (toutes les 18s côté
  // admin/index.html tant que l'onglet reste ouvert).
  const [
    resasRes,
    caTotalRes,
    parc,
    incidentsOuvertsRes,
    incidentsPeriodeRes,
    resasHierRes,
    missionsTermineesHierRes,
    incidentsHierRes,
    missionsEnCoursRes,
    missionsTermineesPeriodeRes,
    missionsEnRetardRes,
  ] = await Promise.all([
    // 'confirmee' OU 'terminee' — une réservation passe à 'terminee' dès la
    // récupération effectuée (fin de location normale). Sur une période courte
    // (ex. "jour"/"7j"), une location déjà terminée créée dans la fenêtre
    // disparaissait purement et simplement du CA et du nombre de réservations
    // affichés — même défaut que ca_total_ville ci-dessous (voir
    // supabase/migration_ca_total_terminee.sql, à valider avant d'être collée
    // en base).
    supabase
      .from('reservations')
      .select('prix_total_cents')
      .eq('city_id', city.id)
      .in('statut', ['confirmee', 'terminee'])
      .gte('created_at', since),
    // Somme calculée côté base (fonction SQL `ca_total_ville`, voir
    // supabase/migration_dashboard_ca_total.sql) plutôt que de télécharger une
    // ligne par réservation confirmée de tout l'historique de la ville.
    supabase.rpc('ca_total_ville', { p_city_id: city.id }),
    // Même source que le bloc "État du parc" juste en dessous sur cet écran
    // (computeParcDashboard, statut réel de chaque appareil) — la tuile
    // "Occupation" utilisait avant un calcul indépendant basé sur les
    // réservations à venir (getAvailability), qui pouvait afficher un
    // pourcentage différent de "État du parc" au même instant (même défaut
    // que la barre "Flotte" de l'onglet Stock, corrigé en PR #329) : un
    // appareil marqué "Loué hors système" sans réservation suivie apparaissait
    // "disponible" côté réservations mais "occupé" côté statut réel.
    computeParcDashboard(supabase, city.id),
    supabase.from('incidents').select('id', { count: 'exact', head: true }).eq('city_id', city.id).in('statut', INCIDENT_OPEN_STATUSES),
    supabase.from('incidents').select('id', { count: 'exact', head: true }).eq('city_id', city.id).gte('created_at', since),
    supabase.from('reservations').select('prix_total_cents')
      .eq('city_id', city.id).in('statut', ['confirmee', 'terminee'])
      .gte('created_at', hierStart).lt('created_at', hierEnd),
    // Filtre d'abord sur la journée d'hier (gte/lt sur fait_at) — livraisons n'a
    // pas de city_id direct, donc on rattache la ville via un inner join sur
    // reservations plutôt que de télécharger d'abord TOUS les ids de réservation
    // de la ville (potentiellement tout l'historique) pour filtrer dessus ensuite.
    supabase
      .from('livraisons')
      .select('id, reservation:reservations!inner(city_id)', { count: 'exact', head: true })
      .eq('reservation.city_id', city.id)
      .eq('statut', 'fait')
      .gte('fait_at', hierStart).lt('fait_at', hierEnd),
    supabase.from('incidents').select('id', { count: 'exact', head: true })
      .eq('city_id', city.id).gte('created_at', hierStart).lt('created_at', hierEnd),
    // Bloc "Logistique" (Module 7, Bloc 5) : au-delà du seul résumé du jour
    // déjà affiché plus haut — missions en cours, terminées sur la période,
    // et en retard, tous types confondus (livraison/récupération/changement).
    supabase
      .from('livraisons')
      .select('id, reservation:reservations!inner(city_id)', { count: 'exact', head: true })
      .eq('reservation.city_id', city.id)
      .in('statut', ['en_route', 'arrivee']),
    supabase
      .from('livraisons')
      .select('id, reservation:reservations!inner(city_id)', { count: 'exact', head: true })
      .eq('reservation.city_id', city.id)
      .eq('statut', 'fait').gte('fait_at', since),
    supabase
      .from('livraisons')
      .select('id, reservation:reservations!inner(city_id)', { count: 'exact', head: true })
      .eq('reservation.city_id', city.id)
      .in('statut', ['a_faire', 'acceptee']).lt('date_prevue', todayStr),
  ]);

  const { data: resas, error: resaErr } = resasRes;
  if (resaErr) throw resaErr;
  const caCents = (resas || []).reduce((sum, r) => sum + (r.prix_total_cents || 0), 0);

  const { data: caTotalCentsRaw, error: caTotalErr } = caTotalRes;
  if (caTotalErr) throw caTotalErr;
  const caTotalCents = typeof caTotalCentsRaw === 'number' ? caTotalCentsRaw : 0;

  const flotteTotale   = Math.max(0, parc.total - parc.hors_service);
  const disponibles    = parc.disponibles;
  const occupees        = Math.max(0, flotteTotale - disponibles);
  const tauxOccupation = flotteTotale > 0 ? occupees / flotteTotale : 0;

  const incidentsOuverts = incidentsOuvertsRes.count;
  const incidentsPeriode = incidentsPeriodeRes.count;

  const { data: resasHier } = resasHierRes;
  const caHierCents = (resasHier || []).reduce((sum, r) => sum + (r.prix_total_cents || 0), 0);

  const { count: missionsTermineesHierCount, error: missionsHierErr } = missionsTermineesHierRes;
  if (missionsHierErr) throw missionsHierErr;
  const missionsTermineesHier = missionsTermineesHierCount || 0;
  const { count: incidentsHier } = incidentsHierRes;

  const { count: missionsEnCours } = missionsEnCoursRes;
  const { count: missionsTermineesPeriode } = missionsTermineesPeriodeRes;
  const { count: missionsEnRetard } = missionsEnRetardRes;

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
  // 4 requêtes indépendantes — un seul aller-retour groupé plutôt que 4
  // l'un après l'autre (même raisonnement que computeCityStats ci-dessus).
  const [
    { count: partenairesActifs },
    { count: commandesPeriode },
    { count: commissionsAValider },
    { count: commissionsPayeesPeriode },
  ] = await Promise.all([
    supabase.from('partenaires').select('id', { count: 'exact', head: true }).eq('actif', true),
    supabase.from('reservations').select('id', { count: 'exact', head: true })
      .not('partenaire_id', 'is', null).gte('created_at', since),
    supabase.from('partenaire_virements').select('id', { count: 'exact', head: true }).eq('statut', 'demande'),
    supabase.from('partenaire_virements').select('id', { count: 'exact', head: true })
      .eq('statut', 'verse').gte('verse_at', since),
  ]);
  return {
    partenaires_actifs:        partenairesActifs || 0,
    commandes_periode:         commandesPeriode || 0,
    commissions_a_valider:     commissionsAValider || 0,
    commissions_payees_periode: commissionsPayeesPeriode || 0,
  };
}

// Anticipation de la demande (Module 8) — jusqu'ici une seule alerte
// ponctuelle existait (cron-daily.js, "stock saturé J+7"), sans vue
// d'ensemble sur plusieurs semaines. getAvailability (api/_lib/stock.js,
// RPC available_units) donne déjà la disponibilité sur une plage de dates ;
// il suffit de l'appeler une fois par semaine à venir pour obtenir une vraie
// prévision, sans toucher à la base.
async function computePrevisions(supabase, cities) {
  const flottes = await Promise.all(cities.map(async city => {
    const { count } = await supabase
      .from('appareils').select('id', { count: 'exact', head: true })
      .eq('city_id', city.id).not('statut', 'in', '(panne,maintenance,vendu)');
    return count || 0;
  }));
  const flotteTotale = flottes.reduce((s, n) => s + n, 0);

  const today = todayParis();
  const NB_SEMAINES = 8;
  const semaines = await Promise.all(
    Array.from({ length: NB_SEMAINES }, (_, i) => {
      const debut = addDays(today, i * 7);
      const fin = addDays(debut, 7);
      return Promise.all(cities.map(city => getAvailability(supabase, city.id, debut, fin)))
        .then(parVille => ({
          semaine_debut: debut,
          dispo: Math.max(0, parVille.reduce((s, n) => s + n, 0)),
          flotte_totale: flotteTotale,
        }));
    })
  );
  return semaines;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body    = req.body || {};
  const periode = body.periode || '7j';
  const since   = rangeStartISO(periode);

  try {
    if (body.action === 'export_comptable') {
      const adminRole = await checkAdminRole(req, supabase);
      if (!adminRole.ok || !roleHasAccess(adminRole.role, 'finances')) {
        return res.status(403).json({ error: "Ton compte n'a pas accès à l'export comptable." });
      }
      if (!isValidDate(body.date_debut) || !isValidDate(body.date_fin) || body.date_debut > body.date_fin) {
        return res.status(400).json({ error: 'Période invalide' });
      }
      const cities = body.city_id === 'all' ? await listCities(supabase) : [await resolveAdminCity(supabase, body)];
      if (!cities[0]) return res.status(404).json({ error: 'Aucune ville configurée' });
      const result = await computeExportComptable(supabase, cities.map(c => c.id), body.date_debut, body.date_fin);
      return res.status(200).json(result);
    }

    if (body.action === 'previsions') {
      const cities = body.city_id === 'all' ? await listCities(supabase) : [await resolveAdminCity(supabase, body)];
      if (!cities[0]) return res.status(404).json({ error: 'Aucune ville configurée' });
      const semaines = await computePrevisions(supabase, cities);
      return res.status(200).json({ semaines });
    }

    // Tableau de bord principal : agrège toutes les villes actives, avec le
    // détail par ville pour la ligne de tableau — le sélecteur envoie
    // city_id:'all' quand aucune ville précise n'est choisie.
    if (body.city_id === 'all') {
      const cities = await listCities(supabase);
      // Chaque ville est indépendante (aucun état partagé entre itérations) —
      // on les calcule en parallèle plutôt qu'une par une, ce qui évite
      // d'attendre N fois la durée d'une seule ville pour N villes. Le bloc
      // partenaires ne dépend d'aucune ville non plus : calculé en même temps
      // plutôt qu'après, au lieu d'attendre encore un aller-retour de plus.
      const [parVille, partenaires] = await Promise.all([
        Promise.all(cities.map(city => computeCityStats(supabase, city, periode, since))),
        computePartenairesBlock(supabase, since),
      ]);
      const sum = (key) => parVille.reduce((s, v) => s + (v[key] || 0), 0);
      const sumHier = (key) => parVille.reduce((s, v) => s + (v.hier[key] || 0), 0);
      const sumParc = (key) => parVille.reduce((s, v) => s + (v.parc[key] || 0), 0);
      const sumLog  = (key) => parVille.reduce((s, v) => s + (v.logistique[key] || 0), 0);
      const nbResaTotal = sum('nb_reservations');
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
    // Les deux ne dépendent pas l'un de l'autre — calculés en même temps.
    const [stats, partenaires] = await Promise.all([
      computeCityStats(supabase, city, periode, since),
      computePartenairesBlock(supabase, since),
    ]);
    stats.partenaires = partenaires;
    return res.status(200).json(stats);
  } catch (err) {
    console.error('[Admin dashboard]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
