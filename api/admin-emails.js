const { getSupabase } = require('./_lib/supabase');
const { checkAdminToken } = require('./_lib/auth');
const { resolveAdminCity } = require('./_lib/city');
const { SCENARIOS, sendScenarioEmail } = require('./_lib/emailEngine');
const { upcomingScenariosForReservation } = require('./_lib/emailSchedule');
const { buildCommunicationsCockpit, scenarioLibelle, EVENT_SCENARIOS } = require('./_lib/communicationsCockpit');

const RESEND_ERROR_LABEL = {
  no_email: "Ce client n'a pas d'email enregistré",
  skipped_by_admin: 'Cet envoi a été mis en pause/supprimé depuis la fiche client — reprends-le avant de le renvoyer',
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

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

    // Liste des scénarios et de leur état actif/inactif.
    if (action === 'scenarios') {
      const { data, error } = await supabase.from('email_scenarios').select('id, libelle, actif').order('id');
      if (error) throw error;
      return res.status(200).json({ scenarios: data || [] });
    }

    // Active/désactive un scénario — n'affecte que les envois futurs
    // (n'annule rien de déjà programmé, puisque tout est réévalué chaque
    // jour à partir de Supabase, jamais figé à l'avance).
    if (action === 'toggle_scenario') {
      const id = String(body.id || '');
      if (!SCENARIOS[id] && id !== 'confirmation') return res.status(400).json({ error: 'Scénario inconnu' });
      const { error } = await supabase.from('email_scenarios').update({ actif: !!body.actif }).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // Renvoi manuel d'un email de scénario pour une réservation — contourne
    // la garde "jamais deux fois" (force:true) mais reste historisé.
    if (action === 'resend') {
      const reservationId = parseInt(body.reservation_id);
      const scenario = String(body.scenario || '');
      if (!reservationId || !SCENARIOS[scenario]) {
        return res.status(400).json({ error: 'reservation_id et scenario valides requis' });
      }
      const result = await sendScenarioEmail(supabase, { reservationId, scenario, force: true });
      if (!result.sent) return res.status(422).json({ error: RESEND_ERROR_LABEL[result.reason] || (result.error || result.reason) });
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
        .from('reservations').select('id, ref, statut, date_debut, date_fin').eq('client_id', clientId);
      const resaIds = (resas || []).map(r => r.id);
      if (!resaIds.length) return res.status(200).json({ sent: [], upcoming: [], evenementiels: [] });

      const todayISO = new Date().toISOString().slice(0, 10);
      const [logRes, sentRes, skipRes, scenariosRes] = await Promise.all([
        supabase.from('email_log').select('id, reservation_id, scenario, canal, destinataire, statut, erreur, created_at')
          .in('reservation_id', resaIds).order('created_at', { ascending: false }).limit(200),
        supabase.from('email_sent').select('reservation_id, scenario').in('reservation_id', resaIds),
        supabase.from('email_skip').select('reservation_id, scenario, action').in('reservation_id', resaIds),
        supabase.from('email_scenarios').select('id, actif'),
      ]);

      const resaById = Object.fromEntries((resas || []).map(r => [r.id, r]));
      const sentSet = new Set((sentRes.data || []).map(s => `${s.reservation_id}:${s.scenario}`));
      const skipByKey = Object.fromEntries((skipRes.data || []).map(s => [`${s.reservation_id}:${s.scenario}`, s.action]));
      const scenarioActif = Object.fromEntries((scenariosRes.data || []).map(s => [s.id, s.actif !== false]));

      const upcoming = [];
      for (const resa of resas || []) {
        for (const { scenario, date } of upcomingScenariosForReservation(resa, todayISO)) {
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
