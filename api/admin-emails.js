const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');
const { resolveAdminCity } = require('./_lib/city');
const { SCENARIOS, sendScenarioEmail } = require('./_lib/emailEngine');
const { upcomingScenariosForReservation } = require('./_lib/emailSchedule');
const { buildCommunicationsCockpit, scenarioLibelle, EVENT_SCENARIOS, SMS_DATED_SCENARIOS } = require('./_lib/communicationsCockpit');
const { sendRelanceProlongationSms, sendRappelRecuperationSms } = require('./_lib/reservations');
const { todayParis } = require('./_lib/dates');

const RESEND_ERROR_LABEL = {
  no_email: "Ce client n'a pas d'email enregistré",
  no_tel: "Ce client n'a pas de téléphone enregistré",
  skipped_by_admin: 'Cet envoi a été mis en pause/supprimé depuis la fiche client — reprends-le avant de le renvoyer',
};

const SMS_SENDER_BY_SCENARIO = {
  sms_relance_prolongation: sendRelanceProlongationSms,
  sms_rappel_recuperation: sendRappelRecuperationSms,
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    // Historique des emails envoyés/en erreur — optionnellement filtré par
    // réservation ou par scénario, le plus récent en premier. Scopé à la
    // ville de l'admin via la réservation liée (jointure !inner) — sans ça,
    // cet historique mélangeait les emails/SMS (et les noms/adresses email
    // des clients) de TOUTES les villes, contrairement au reste de l'admin.
    if (action === 'list') {
      const city = await resolveAdminCity(supabase, body);
      if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });
      let query = supabase
        .from('email_log')
        .select('id, reservation_id, scenario, destinataire, statut, erreur, created_at, reservation:reservations!inner(ref, prenom, nom, city_id)')
        .eq('reservation.city_id', city.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (body.reservation_id) query = query.eq('reservation_id', parseInt(body.reservation_id));
      if (body.scenario) query = query.eq('scenario', body.scenario);
      if (body.statut) query = query.eq('statut', body.statut);
      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ emails: data || [] });
    }

    // Panneau "Communications" (cockpit) — vue d'ensemble de TOUS les canaux
    // de communication client (emails/SMS du moteur de scénarios + envois
    // ponctuels + notification d'arrivée transporteur) pour toutes les
    // réservations actives de la ville, avec détection d'anomalie — voir
    // _lib/communicationsCockpit.js pour la logique complète (partagée avec
    // le badge de admin-alerts.js).
    if (action === 'cockpit') {
      const city = await resolveAdminCity(supabase, body);
      if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });
      const result = await buildCommunicationsCockpit(supabase, city.id);
      return res.status(200).json(result);
    }

    // Récap "communications du jour" — cadre dédié en haut de l'onglet
    // Communications : tout ce qui est réellement parti aux clients (email +
    // SMS, tous scénarios confondus) depuis minuit, pour que l'admin voie
    // l'activité du jour sans avoir à ouvrir chaque fiche client.
    if (action === 'jour') {
      const city = await resolveAdminCity(supabase, body);
      if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });
      const debutJour = new Date(); debutJour.setUTCHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('email_log')
        .select('id, scenario, canal, statut, erreur, destinataire, created_at, reservation:reservations!inner(ref, prenom, nom, city_id)')
        .eq('reservation.city_id', city.id)
        .gte('created_at', debutJour.toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;
      const items = (data || []).map(it => ({ ...it, libelle: scenarioLibelle(it.scenario) }));
      const summary = { total: items.length, email: 0, sms: 0, erreurs: 0 };
      for (const it of items) {
        if (it.canal === 'sms') summary.sms++; else summary.email++;
        if (it.statut === 'erreur') summary.erreurs++;
      }
      return res.status(200).json({ items, summary });
    }

    // Liste des scénarios et de leur état actif/inactif (+ dernière
    // modification si la migration_2026-08-19_email_scenarios_board.sql est
    // passée — repli silencieux sur l'ancienne forme sinon).
    if (action === 'scenarios') {
      let { data, error } = await supabase.from('email_scenarios').select('id, libelle, actif, updated_at, updated_by').order('id');
      if (error) ({ data, error } = await supabase.from('email_scenarios').select('id, libelle, actif').order('id'));
      if (error) throw error;
      return res.status(200).json({ scenarios: data || [] });
    }

    // Board "emails et SMS actifs" (demande d'Aly, 2026-08-19) — contrairement
    // au cockpit ci-dessus (une ligne par réservation), ici une ligne par
    // TYPE d'envoi : tous les scénarios connus du système (les 8 du moteur +
    // tous les envois ponctuels ad hoc — devis, factures transporteur,
    // rappels de paiement…), avec statut actif/inactif, qui/quand pour le
    // dernier changement, et volume/erreurs des 30 derniers jours. Pas de
    // scope ville : c'est une vue globale de santé du système de
    // communication, pas une vue client (comme 'scenarios' ci-dessus).
    if (action === 'board') {
      let { data: scenarios, error: scenErr } = await supabase.from('email_scenarios').select('id, libelle, actif, updated_at, updated_by').order('id');
      if (scenErr) ({ data: scenarios, error: scenErr } = await supabase.from('email_scenarios').select('id, libelle, actif').order('id'));
      if (scenErr) throw scenErr;

      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const { data: logs30, error: logErr } = await supabase
        .from('email_log').select('scenario, canal, statut, created_at').gte('created_at', since);
      if (logErr) throw logErr;

      // Catalogue complet : email_scenarios (seuls togglables) puis complété
      // par les libellés connus (SCENARIOS + AD_HOC_LABEL), puis par tout
      // scénario observé dans les 30 derniers jours mais absent des deux
      // (filet de sécurité si un futur envoi oublie de se déclarer quelque part).
      const catalogue = new Map();
      for (const s of scenarios || []) {
        catalogue.set(s.id, { id: s.id, libelle: s.libelle, togglable: true, actif: s.actif !== false, updated_at: s.updated_at || null, updated_by: s.updated_by || null });
      }
      for (const id of Object.keys(SCENARIOS)) {
        if (!catalogue.has(id)) catalogue.set(id, { id, libelle: SCENARIOS[id].libelle, togglable: false, actif: true, updated_at: null, updated_by: null });
      }
      for (const id of Object.keys(AD_HOC_LABEL)) {
        if (!catalogue.has(id)) catalogue.set(id, { id, libelle: AD_HOC_LABEL[id], togglable: false, actif: true, updated_at: null, updated_by: null });
      }
      for (const l of logs30 || []) {
        if (!catalogue.has(l.scenario)) catalogue.set(l.scenario, { id: l.scenario, libelle: scenarioLibelle(l.scenario), togglable: false, actif: true, updated_at: null, updated_by: null });
      }

      const logsByScenario = new Map();
      for (const l of logs30 || []) {
        if (!logsByScenario.has(l.scenario)) logsByScenario.set(l.scenario, []);
        logsByScenario.get(l.scenario).push(l);
      }

      const items = Array.from(catalogue.values()).map(item => {
        const mine = logsByScenario.get(item.id) || [];
        const envoyes = mine.filter(l => l.statut === 'envoye').length;
        const erreurs = mine.filter(l => l.statut === 'erreur').length;
        const canaux = Array.from(new Set(mine.map(l => l.canal).filter(Boolean)));
        const canal = canaux.length ? canaux.join('+') : (item.id.startsWith('sms_') ? 'sms' : 'email');
        let dernier = null;
        for (const l of mine) { if (!dernier || l.created_at > dernier.created_at) dernier = l; }
        return {
          ...item, canal,
          volume_30j: envoyes, erreurs_30j: erreurs,
          dernier_envoi: dernier ? dernier.created_at : null,
          dernier_statut: dernier ? dernier.statut : null,
        };
      });
      // Priorité visuelle : erreurs d'abord, puis ordre alphabétique.
      items.sort((a, b) => (b.erreurs_30j - a.erreurs_30j) || a.libelle.localeCompare(b.libelle, 'fr'));

      return res.status(200).json({ items });
    }

    // Active/désactive un scénario — n'affecte que les envois futurs
    // (n'annule rien de déjà programmé, puisque tout est réévalué chaque
    // jour à partir de Supabase, jamais figé à l'avance).
    if (action === 'toggle_scenario') {
      // Désactiver un scénario coupe des communications pour TOUS les clients —
      // réservé aux comptes avec accès support (ne pas laisser un compte
      // comptabilité couper les rappels de récupération par erreur).
      if (!roleHasAccess(admin.role, 'support')) return res.status(403).json({ error: "Ton compte n'a pas accès à la gestion des scénarios d'envoi." });
      const id = String(body.id || '');
      // Avant : rejetait tout id absent des 8 scénarios du moteur (SCENARIOS),
      // alors que email_scenarios contient aussi 6 lignes "ad hoc" (SMS
      // confirmation, prolongation…) — leur case à cocher dans l'onglet Emails
      // renvoyait donc systématiquement "Scénario inconnu" (bug trouvé lors de
      // l'audit "board communications", 2026-08-19). On vérifie maintenant
      // l'existence via l'UPDATE lui-même (id présent en base), plus fiable
      // qu'une liste en dur à maintenir à la main.
      //
      // updated_at/updated_by (migration_2026-08-19_email_scenarios_board.sql) —
      // tant que la migration n'est pas passée en prod, l'UPDATE avec ces
      // colonnes échoue (colonne inconnue) : on retombe alors sur l'ancien
      // comportement (actif seul) pour ne jamais casser le toggle existant.
      let { data, error } = await supabase.from('email_scenarios')
        .update({ actif: !!body.actif, updated_at: new Date().toISOString(), updated_by: admin.nom || admin.role || 'admin' })
        .eq('id', id).select('id');
      if (error) {
        ({ data, error } = await supabase.from('email_scenarios').update({ actif: !!body.actif }).eq('id', id).select('id'));
      }
      if (error) throw error;
      if (!data || !data.length) return res.status(400).json({ error: 'Scénario inconnu' });
      return res.status(200).json({ ok: true });
    }

    // Renvoi manuel d'un email de scénario pour une réservation — contourne
    // la garde "jamais deux fois" (force:true) mais reste historisé. Couvre
    // aussi les 2 SMS automatisés traités comme des scénarios datés
    // (sms_relance_prolongation, sms_rappel_recuperation — voir
    // _lib/communicationsCockpit.js) : même bouton "Envoyer maintenant"/
    // "Renvoyer" que pour un email, mais délègue à la fonction SMS dédiée.
    if (action === 'resend') {
      const reservationId = parseInt(body.reservation_id);
      const scenario = String(body.scenario || '');
      const isSmsScenario = SMS_DATED_SCENARIOS.includes(scenario);
      if (!reservationId || (!SCENARIOS[scenario] && !isSmsScenario)) {
        return res.status(400).json({ error: 'reservation_id et scenario valides requis' });
      }
      const city = await resolveAdminCity(supabase, body);
      if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });

      if (isSmsScenario) {
        // reservation_origine_id : nécessaire à sendRappelRecuperationSms
        // pour recalculer la vraie date de fin (getEffectiveDateFin) — sans
        // lui, un renvoi manuel depuis l'admin afficherait la même date
        // figée que l'envoi automatique en cas de prolongation mal
        // synchronisée (voir _lib/reservations.js).
        const { data: resaSms } = await supabase
          .from('reservations').select('id, tel, lang, prenom, ref, date_fin, reservation_origine_id')
          .eq('id', reservationId).eq('city_id', city.id).maybeSingle();
        if (!resaSms) return res.status(404).json({ error: 'Réservation introuvable' });
        const result = await SMS_SENDER_BY_SCENARIO[scenario](supabase, resaSms, { force: true });
        // `reason` en plus du message traduit — sans lui, le front ne peut
        // distinguer "en pause" (récupérable en 1 clic : reprendre puis
        // renvoyer) des autres échecs (voir envoyerRappelRecuperation() côté
        // admin/index.html, demande d'Aly "je veux pouvoir l'envoyer à tout
        // moment si besoin", 2026-08-25).
        if (!result.sent) return res.status(422).json({ error: RESEND_ERROR_LABEL[result.reason] || (result.error || result.reason), reason: result.reason });
        return res.status(200).json({ ok: true });
      }

      const { data: resaOwned } = await supabase.from('reservations').select('id').eq('id', reservationId).eq('city_id', city.id).maybeSingle();
      if (!resaOwned) return res.status(404).json({ error: 'Réservation introuvable' });
      const result = await sendScenarioEmail(supabase, { reservationId, scenario, force: true });
      if (!result.sent) return res.status(422).json({ error: RESEND_ERROR_LABEL[result.reason] || (result.error || result.reason), reason: result.reason });
      return res.status(200).json({ ok: true });
    }

    // Historique + envois à venir d'un client précis (fiche client admin,
    // panneau Communications) — remonte par ses réservations puisque
    // email_log/email_sent/email_skip n'ont pas de client_id direct (même
    // pattern que les incidents dans admin-clients.js action 'fiche').
    if (action === 'client_timeline') {
      const clientId = parseInt(body.client_id);
      if (!clientId) return res.status(400).json({ error: 'client_id manquant' });

      const city = await resolveAdminCity(supabase, body);
      if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });
      const { data: client } = await supabase.from('clients').select('id').eq('id', clientId).eq('city_id', city.id).maybeSingle();
      if (!client) return res.status(404).json({ error: 'Client introuvable' });

      const { data: resas } = await supabase
        .from('reservations').select('id, ref, statut, date_debut, date_fin').eq('client_id', clientId).eq('city_id', city.id);
      // Audit 2026-08-06 I1 cron : upcomingScenariosForReservation() utilise
      // date_fin+0 pour la date du rappel récupération quand recupDatePrevue
      // est absent — si le client a avancé sa récupération via client-recup.js,
      // la date affichée dans le panneau Communications serait fausse.
      // On récupère la date réelle de la mission de récupération active.
      const resaIds = (resas || []).map(r => r.id);
      if (!resaIds.length) return res.status(200).json({ sent: [], upcoming: [], evenementiels: [] });

      const todayISO = todayParis();
      const [logRes, sentRes, skipRes, scenariosRes, recupMissionsRes] = await Promise.all([
        supabase.from('email_log').select('id, reservation_id, scenario, canal, destinataire, statut, erreur, created_at')
          .in('reservation_id', resaIds).order('created_at', { ascending: false }).limit(200),
        supabase.from('email_sent').select('reservation_id, scenario').in('reservation_id', resaIds),
        supabase.from('email_skip').select('reservation_id, scenario, action').in('reservation_id', resaIds),
        supabase.from('email_scenarios').select('id, actif'),
        // Date réelle de la mission de récupération active pour ce client
        supabase.from('livraisons').select('reservation_id, date_prevue')
          .in('reservation_id', resaIds).eq('type', 'recuperation')
          .not('statut', 'in', '("annule","annulee","refusee")'),
      ]);

      const resaById = Object.fromEntries((resas || []).map(r => [r.id, r]));
      const sentSet = new Set((sentRes.data || []).map(s => `${s.reservation_id}:${s.scenario}`));
      const skipByKey = Object.fromEntries((skipRes.data || []).map(s => [`${s.reservation_id}:${s.scenario}`, s.action]));
      const scenarioActif = Object.fromEntries((scenariosRes.data || []).map(s => [s.id, s.actif !== false]));
      const recupDateByResaId = Object.fromEntries((recupMissionsRes.data || []).map(l => [l.reservation_id, l.date_prevue]));

      const upcoming = [];
      for (const resa of resas || []) {
        for (const { scenario, date } of upcomingScenariosForReservation(resa, todayISO, { recupDatePrevue: recupDateByResaId[resa.id] })) {
          const key = `${resa.id}:${scenario}`;
          if (sentSet.has(key)) continue; // déjà parti (cron passé aujourd'hui même)
          upcoming.push({
            reservation_id: resa.id, ref: resa.ref, scenario,
            libelle: SCENARIOS[scenario]?.libelle || scenario,
            date, actif_globalement: scenarioActif[scenario] !== false,
            skip: skipByKey[key] || null,
          });
        }
      }
      upcoming.sort((a, b) => a.date.localeCompare(b.date));

      // Scénarios événementiels (confirmation, post-installation, fin de
      // location) : déclenchés par le code métier (webhook Stripe, actions
      // transporteur), jamais par une date calculée — ils n'apparaissent donc
      // jamais dans `upcoming` ci-dessus. S'ils n'ont jamais été tentés (email
      // manquant, erreur avalée), rien ne les distingue nulle part dans la
      // fiche — cette liste comble ce trou en donnant un bouton d'envoi manuel
      // même pour un envoi qui n'a jamais eu lieu.
      const evenementiels = [];
      for (const resa of resas || []) {
        for (const scenario of EVENT_SCENARIOS) {
          const key = `${resa.id}:${scenario}`;
          if (sentSet.has(key)) continue; // déjà réellement envoyé — visible dans "sent" ci-dessous
          evenementiels.push({
            reservation_id: resa.id, ref: resa.ref, scenario,
            libelle: SCENARIOS[scenario]?.libelle || scenario,
            actif_globalement: scenarioActif[scenario] !== false,
            skip: skipByKey[key] || null,
          });
        }
      }

      const sent = (logRes.data || []).map(e => ({ ...e, ref: resaById[e.reservation_id]?.ref || null, libelle: scenarioLibelle(e.scenario) }));
      return res.status(200).json({ sent, upcoming, evenementiels });
    }

    // Pose une exclusion sur un envoi précis à venir — bloque
    // sendScenarioEmail() pour cette réservation+scénario, sans toucher aux
    // autres scénarios ni aux autres réservations (voir wasScenarioSkipped
    // dans _lib/emailEngine.js).
    if (action === 'skip') {
      const reservationId = parseInt(body.reservation_id);
      const scenario = String(body.scenario || '');
      const skipAction = body.skip_action === 'pause' ? 'pause' : 'suppression';
      if (!reservationId || !scenario) return res.status(400).json({ error: 'reservation_id et scenario requis' });
      const citySkip = await resolveAdminCity(supabase, body);
      if (!citySkip) return res.status(404).json({ error: 'Aucune ville configurée' });
      const { data: resaOwnedSkip } = await supabase.from('reservations').select('id').eq('id', reservationId).eq('city_id', citySkip.id).maybeSingle();
      if (!resaOwnedSkip) return res.status(404).json({ error: 'Réservation introuvable' });
      const { error } = await supabase.from('email_skip')
        .upsert({ reservation_id: reservationId, scenario, action: skipAction }, { onConflict: 'reservation_id,scenario' });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // Aperçu fidèle d'un envoi précis (fiche client + onglet Emails) —
    // contenu réel sauvegardé au moment de l'envoi (voir sendScenarioEmail()
    // et les points d'enregistrement best-effort dans webhook.js,
    // documents.js, transporteur-action.js). Scopé à la ville de l'admin via
    // la réservation liée, comme le reste de ce fichier.
    if (action === 'content') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const city = await resolveAdminCity(supabase, body);
      if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });
      const { data: log } = await supabase
        .from('email_log').select('canal, contenu, reservation:reservations(city_id)').eq('id', id).maybeSingle();
      if (!log || log.reservation?.city_id !== city.id) return res.status(404).json({ error: 'Introuvable' });
      if (!log.contenu) return res.status(404).json({ error: 'Aperçu non disponible pour cet envoi (antérieur à cette fonctionnalité)' });
      return res.status(200).json({ canal: log.canal, contenu: log.contenu });
    }

    // Retire une exclusion ("Reprendre") — sans effet si la date est déjà
    // passée, l'envoi n'aura simplement plus jamais lieu de toute façon.
    if (action === 'unskip') {
      const reservationId = parseInt(body.reservation_id);
      const scenario = String(body.scenario || '');
      if (!reservationId || !scenario) return res.status(400).json({ error: 'reservation_id et scenario requis' });
      const cityUnskip = await resolveAdminCity(supabase, body);
      if (!cityUnskip) return res.status(404).json({ error: 'Aucune ville configurée' });
      const { data: resaOwnedUnskip } = await supabase.from('reservations').select('id').eq('id', reservationId).eq('city_id', cityUnskip.id).maybeSingle();
      if (!resaOwnedUnskip) return res.status(404).json({ error: 'Réservation introuvable' });
      const { error } = await supabase.from('email_skip').delete().eq('reservation_id', reservationId).eq('scenario', scenario);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin emails]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
