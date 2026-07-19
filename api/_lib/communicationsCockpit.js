const { SCENARIOS } = require('./emailEngine');
const { upcomingScenariosForReservation, pastScenariosForReservation, daysDiff } = require('./emailSchedule');

// Libellés des envois ponctuels hors moteur de scénarios (voir
// api/webhook.js, api/_lib/documents.js, api/transporteur-action.js) —
// SCENARIOS (emailEngine.js) ne couvre que les 8 scénarios du moteur.
const AD_HOC_LABEL = {
  sms_confirmation:       'SMS confirmation de réservation',
  email_prolongation:     'Email confirmation de prolongation',
  email_contrat_facture:  'Email contrat + facture',
  sms_mission_confirmee:  'SMS mission confirmée',
  sms_client_absent:      'SMS client absent',
  email_facture_vente:    'Email facture de vente (Offre Privilège)',
};
function scenarioLibelle(scenario) {
  return SCENARIOS[scenario]?.libelle || AD_HOC_LABEL[scenario] || scenario;
}

// Sous-ensemble de SCENARIOS déclenché par le code métier (webhook Stripe,
// actions transporteur) plutôt que par une date calculée — voir
// emailSchedule.js. N'apparaît donc jamais dans upcoming/pastScenariosForReservation.
const EVENT_SCENARIOS = ['confirmation', 'post_installation', 'fin_location'];

const DATED_SCENARIOS = ['suivi_j14', 'preparation_j3', 'rappel_j1', 'avant_fin_location', 'rappel_recuperation'];
const AD_HOC_SCENARIOS = Object.keys(AD_HOC_LABEL);

// Fenêtre glissante : combien de jours après la fin de location une
// réservation "terminee" reste visible dans le panneau — assez pour
// détecter une anomalie sur le tout dernier email (fin de location) sans
// garder indéfiniment de très vieux dossiers déjà clos.
const WINDOW_DAYS = 30;

// Construit, pour toutes les réservations actives d'une ville, l'état de
// TOUS les canaux de communication client connus (les 8 emails/SMS du
// moteur de scénarios, les envois ponctuels, et la notification d'arrivée
// auto-déclarée par le transporteur) — avec détection d'anomalie (jamais
// envoyé alors que dû, ou dernier envoi en erreur). Partagé entre
// api/admin-emails.js (panneau détaillé "Communications") et
// api/admin-alerts.js (badge de comptage) pour n'avoir qu'une seule
// définition de ce qu'est une anomalie.
async function buildCommunicationsCockpit(supabase, cityId) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - WINDOW_DAYS);
  const windowStartISO = windowStart.toISOString().slice(0, 10);

  const { data: resas, error: resasErr } = await supabase
    .from('reservations')
    .select('id, ref, prenom, nom, statut, date_debut, date_fin, email, tel')
    .eq('city_id', cityId)
    .in('statut', ['confirmee', 'terminee'])
    .gte('date_fin', windowStartISO)
    .order('date_debut', { ascending: true });
  if (resasErr) throw resasErr;
  const resaList = resas || [];
  const resaIds = resaList.map(r => r.id);
  if (!resaIds.length) return { clients: [], anomalies: 0 };

  const [logRes, sentRes, skipRes, scenariosRes, livRes] = await Promise.all([
    supabase.from('email_log').select('id, reservation_id, scenario, canal, statut, erreur, created_at')
      .in('reservation_id', resaIds).order('created_at', { ascending: false }),
    supabase.from('email_sent').select('reservation_id, scenario').in('reservation_id', resaIds),
    supabase.from('email_skip').select('reservation_id, scenario, action').in('reservation_id', resaIds),
    supabase.from('email_scenarios').select('id, actif'),
    // 'changement' inclus aussi : la notification d'arrivée (prevenir_client,
    // voir transporteur-action.js) n'est restreinte à aucun type de mission,
    // contrairement à post_installation/fin_location ci-dessous qui ne
    // concernent QUE livraison/recuperation — installationDone/recuperationDone
    // filtrent explicitement par type, donc 'changement' n'y interfère pas.
    supabase.from('livraisons').select('reservation_id, type, statut, date_prevue, client_notifie_at')
      .in('reservation_id', resaIds).in('type', ['livraison', 'recuperation', 'changement']),
  ]);

  // Le plus récent par (réservation, scénario) — email_log est déjà trié
  // desc côté requête, donc la première rencontre gagne.
  const lastLogByKey = {};
  for (const e of (logRes.data || [])) {
    const key = `${e.reservation_id}:${e.scenario}`;
    if (!lastLogByKey[key]) lastLogByKey[key] = e;
  }
  const sentSet = new Set((sentRes.data || []).map(s => `${s.reservation_id}:${s.scenario}`));
  const skipByKey = Object.fromEntries((skipRes.data || []).map(s => [`${s.reservation_id}:${s.scenario}`, s.action]));
  const scenarioActif = Object.fromEntries((scenariosRes.data || []).map(s => [s.id, s.actif]));

  const livByResa = {};
  for (const l of (livRes.data || [])) (livByResa[l.reservation_id] = livByResa[l.reservation_id] || []).push(l);

  // due: true = aurait dû partir (passé) ; false = pas encore dû (à venir/pas
  // encore applicable) ; undefined = pas de notion de date (ad hoc, géré à part).
  function statusFor(resaId, scenario, due) {
    const key = `${resaId}:${scenario}`;
    const log = lastLogByKey[key];
    if (log) {
      return { scenario, libelle: scenarioLibelle(scenario), etat: log.statut === 'erreur' ? 'erreur' : 'envoye', canal: log.canal, at: log.created_at, log_id: log.id, erreur: log.erreur || null };
    }
    if (sentSet.has(key)) return { scenario, libelle: scenarioLibelle(scenario), etat: 'envoye', canal: 'email', at: null, log_id: null };
    if (skipByKey[key]) return { scenario, libelle: scenarioLibelle(scenario), etat: 'pause', skip_action: skipByKey[key] };
    if (due === true) {
      // Scénario désactivé globalement (admin, onglet Emails) : ce n'est
      // pas une anomalie, c'est un choix délibéré qui s'applique à tous.
      if (scenarioActif[scenario] === false) return { scenario, libelle: scenarioLibelle(scenario), etat: 'desactive' };
      return { scenario, libelle: scenarioLibelle(scenario), etat: 'retard' };
    }
    if (due === false) return { scenario, libelle: scenarioLibelle(scenario), etat: 'a_venir' };
    return { scenario, libelle: scenarioLibelle(scenario), etat: 'non_applicable' };
  }

  let totalAnomalies = 0;
  const clients = resaList.map(resa => {
    const pastSet = new Set(pastScenariosForReservation(resa, todayISO).map(c => c.scenario));
    const upcomingSet = new Set(upcomingScenariosForReservation(resa, todayISO).map(c => c.scenario));
    const duree = (resa.date_debut && resa.date_fin) ? daysDiff(resa.date_debut, resa.date_fin) : null;

    const channels = [];
    // confirmation : toujours attendu dès qu'une réservation est confirmée
    // — aucune raison légitime pour qu'elle en soit dépourvue.
    channels.push(statusFor(resa.id, 'confirmation', true));

    for (const scenario of DATED_SCENARIOS) {
      if (scenario === 'avant_fin_location' && !(duree > 4)) continue; // non applicable, jamais montré
      if (pastSet.has(scenario)) channels.push(statusFor(resa.id, scenario, true));
      else if (upcomingSet.has(scenario)) channels.push(statusFor(resa.id, scenario, false));
      // ni passé ni à venir (ex: réservation "terminee" hors fenêtre de ce
      // scénario) -> pas pertinent, on ne l'affiche pas.
    }

    const missions = livByResa[resa.id] || [];
    const installationDone = missions.some(m => m.type === 'livraison' && m.statut === 'fait');
    const recuperationDone = missions.some(m => m.type === 'recuperation' && m.statut === 'fait');
    channels.push(statusFor(resa.id, 'post_installation', installationDone));
    channels.push(statusFor(resa.id, 'fin_location', recuperationDone));

    // Envois ponctuels : pas de notion de "dû", seulement "a eu lieu ou
    // pas" — affichés uniquement s'ils ont réellement eu lieu au moins une
    // fois (sinon on ne saurait pas dire si c'est normal ou une anomalie).
    for (const scenario of AD_HOC_SCENARIOS) {
      const log = lastLogByKey[`${resa.id}:${scenario}`];
      if (log) {
        channels.push({
          scenario, libelle: scenarioLibelle(scenario), etat: log.statut === 'erreur' ? 'erreur' : 'envoye',
          canal: log.canal, at: log.created_at, log_id: log.id, erreur: log.erreur || null, ad_hoc: true,
        });
      }
    }

    // Notification d'arrivée transporteur (SMS/WhatsApp envoyé depuis son
    // propre téléphone, jamais via Brevo — auto-déclarée par
    // livraisons.client_notifie_at) — affichée seulement quand une mission
    // est réellement en cours maintenant, sans quoi elle encombrerait la
    // vue toute la durée du séjour pour rien. Même définition de "en cours"
    // que le serveur (EN_COURS_STATUTS dans transporteur-action.js, qui
    // autorise prevenir_client dès 'acceptee') : une mission juste acceptée
    // pour un jour futur n'est PAS "en cours" (voir date_prevue<=todayISO,
    // même logique que le badge "Programmée" côté admin/transporteur).
    const missionEnCours = missions.find(m =>
      ['en_route', 'arrivee'].includes(m.statut) || (m.statut === 'acceptee' && m.date_prevue && m.date_prevue <= todayISO)
    );
    if (missionEnCours) {
      channels.push({
        scenario: 'notif_arrivee', libelle: "Notification d'arrivée (SMS/WhatsApp du transporteur)",
        etat: missionEnCours.client_notifie_at ? 'envoye' : 'retard', at: missionEnCours.client_notifie_at || null,
        ad_hoc: true, self_declare: true,
      });
    }

    const anomaliesCount = channels.filter(c => c.etat === 'erreur' || c.etat === 'retard').length;
    totalAnomalies += anomaliesCount;
    const applicable = channels.filter(c => c.etat !== 'non_applicable' && !c.ad_hoc);
    const doneCount = applicable.filter(c => c.etat === 'envoye').length;

    return {
      reservation_id: resa.id, ref: resa.ref, prenom: resa.prenom, nom: resa.nom, tel: resa.tel || null,
      statut: resa.statut, date_debut: resa.date_debut, date_fin: resa.date_fin,
      channels, anomalies: anomaliesCount, progress: { done: doneCount, total: applicable.length },
    };
  });

  // Les clients avec le plus d'anomalies remontent en premier — c'est
  // littéralement la liste de ce qu'il faut traiter en priorité.
  clients.sort((a, b) => (b.anomalies - a.anomalies) || a.date_debut.localeCompare(b.date_debut));
  return { clients, anomalies: totalAnomalies };
}

module.exports = { buildCommunicationsCockpit, AD_HOC_LABEL, scenarioLibelle, EVENT_SCENARIOS };
