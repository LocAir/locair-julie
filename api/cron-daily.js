const Stripe = require('stripe');
const { getSupabase }          = require('./_lib/supabase');
const { sendBrevoSms }         = require('./_lib/brevo');
const { pushToAdmin, pushToTransporteur } = require('./_lib/push');
const { getAvailability }      = require('./_lib/stock');
const { notifyIfSoldOut }      = require('./_lib/city');
const { runWeeklyReport }      = require('./cron-weekly');
const { runMonthlyRecap }      = require('./cron-monthly');
const { calcTieredPrice: calcRetardPrice } = require('./_lib/pricing');
const { scenariosDueToday } = require('./_lib/emailSchedule');
const { sendScenarioEmail } = require('./_lib/emailEngine');
const { buildCommunicationsCockpit } = require('./_lib/communicationsCockpit');
const { recordMouvement } = require('./_lib/stockMouvements');
const { sendReservationPaymentLink } = require('./_lib/paymentLink');

function verifyCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers['authorization'] || '') === `Bearer ${secret}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Non autorisé' });

  const supabase    = getSupabase();
  const today       = new Date();
  const todayStr    = today.toISOString().slice(0, 10);
  const tomorrow    = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  const in7d        = new Date(today); in7d.setDate(in7d.getDate() + 7);
  const in7dStr     = in7d.toISOString().slice(0, 10);
  const in8d        = new Date(today); in8d.setDate(in8d.getDate() + 8);
  const in8dStr     = in8d.toISOString().slice(0, 10);

  const report = {};

  // ── 1. Rappel J-1 transporteurs (push, une notif par transporteur même
  // avec plusieurs missions demain — voir aussi 'acceptee', un transporteur
  // qui a déjà accepté sa mission de demain mérite le rappel tout autant) ──
  try {
    const { data: demain } = await supabase
      .from('livraisons')
      .select('transporteur_id')
      .eq('date_prevue', tomorrowStr)
      .in('statut', ['a_faire', 'acceptee'])
      .not('transporteur_id', 'is', null);

    const byTransp = {};
    for (const m of demain || []) {
      byTransp[m.transporteur_id] = (byTransp[m.transporteur_id] || 0) + 1;
    }
    const tids = Object.keys(byTransp).map(Number);

    if (tids.length) {
      await Promise.all(tids.map(tid =>
        pushToTransporteur(supabase, tid, {
          title: '📋 Missions demain',
          body:  `${byTransp[tid]} mission${byTransp[tid] > 1 ? 's' : ''} prévue${byTransp[tid] > 1 ? 's' : ''} demain — ouvre l'app pour voir les détails.`,
          tag:   'rappel-missions-demain',
        })
      ));
      report.transporteurReminders = tids.length;
    }
  } catch (e) {
    console.error('[Cron J-1 transporteur]', e.message);
  }

  // ── 2. Escalade missions non assignées pour demain ───────────────────────────
  // Missions a_faire sans transporteur dans les prochaines 48h → push + SMS admin.
  try {
    const { data: nonAssignees } = await supabase
      .from('livraisons')
      .select('id, date_prevue, type')
      .eq('statut', 'a_faire')
      .is('transporteur_id', null)
      .gte('date_prevue', todayStr)
      .lte('date_prevue', tomorrowStr);

    if (nonAssignees && nonAssignees.length) {
      const nb = nonAssignees.length;
      await pushToAdmin(supabase, {
        title: `⚠️ ${nb} mission${nb > 1 ? 's' : ''} sans transporteur demain`,
        body:  'Des missions pour demain sont encore sans transporteur — assigne maintenant.',
        tag:   'escalade-non-assignees',
      });
      if (process.env.ADMIN_TEL) {
        await sendBrevoSms({
          to:      process.env.ADMIN_TEL,
          content: `Loc'Air admin : ${nb} mission${nb > 1 ? 's' : ''} non assignée${nb > 1 ? 's' : ''} pour demain. Assigne dans l'admin.`,
        }).catch(() => {});
      }
      report.escalade = nb;
    }
  } catch (e) {
    console.error('[Cron escalade]', e.message);
  }

  // ── 3. Retards de récupération ───────────────────────────────────────────────
  // Récupérations dont la date prévue est passée et qui ne sont pas encore faites.
  try {
    const { data: retards } = await supabase
      .from('livraisons')
      .select('id, date_prevue, reservation_id, reservation:reservations(ref, nom, adresse, email, stripe_customer_id, stripe_payment_intent_id, city_id)')
      .eq('type', 'recuperation')
      .in('statut', ['a_faire', 'acceptee'])
      .lt('date_prevue', todayStr);

    let retardCount = 0;
    for (const liv of retards || []) {
      const joursRetard = Math.round((new Date(todayStr) - new Date(liv.date_prevue)) / 86400000);
      const resa = liv.reservation || {};

      await pushToAdmin(supabase, {
        title: `🚨 Retard récupération — ${resa.nom || '?'} (${joursRetard}j)`,
        body:  `Récup. prévue le ${liv.date_prevue}, non effectuée. Dossier ${resa.ref || '?'}.`,
        tag:   `retard-${liv.id}`,
      });
      retardCount++;

      // Prélèvement automatique si explicitement activé et client Stripe connu
      if (process.env.AUTO_LATE_CHARGE !== 'true') continue;
      if (!resa.stripe_customer_id || !process.env.STRIPE_SECRET_KEY) continue;

      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        const methods = await stripe.paymentMethods.list({ customer: resa.stripe_customer_id, type: 'card' });
        if (!methods.data.length) continue;

        const amountCents     = (calcRetardPrice(joursRetard) - calcRetardPrice(joursRetard - 1)) * 100;
        const idempotencyKey  = `retard-${liv.id}-${joursRetard}j-${todayStr}`;
        const intent = await stripe.paymentIntents.create({
          amount:         amountCents,
          currency:       'eur',
          customer:       resa.stripe_customer_id,
          payment_method: methods.data[0].id,
          off_session:    true,
          confirm:        true,
          description:    `Loc'Air — Retard restitution ${joursRetard}j · ${(resa.nom || '').slice(0, 100)}`,
          metadata:       { type: 'retard', jours: String(joursRetard), reservation_id: String(liv.reservation_id) },
        }, { idempotencyKey });

        await supabase.from('incidents').insert({
          city_id:               resa.city_id || null,
          reservation_id:        liv.reservation_id,
          type:                  'retard',
          description:           `${joursRetard}j de retard — prélèvement auto ${(amountCents / 100).toFixed(2)} €`,
          montant_facture_cents: amountCents,
          statut:                'retard_a_facturer',
        });
        console.log('[Cron retard] Prélèvement', intent.id, 'pour reservation', liv.reservation_id);
      } catch (stripeErr) {
        console.error('[Cron retard Stripe]', stripeErr.message, 'reservation', liv.reservation_id);
      }
    }
    if (retardCount) report.retards = retardCount;
  } catch (e) {
    console.error('[Cron retards]', e.message);
  }

  // ── 3bis. Relance des réservations en_attente jamais payées (Module 8) ──────
  // Un panier abandonné sur le site, ou un lien de paiement envoyé par
  // l'admin jamais finalisé, laissait jusqu'ici la réservation en_attente
  // indéfiniment sans jamais relancer le client. email_log
  // (scenario='relance_paiement') sert de mémoire du nombre de relances déjà
  // envoyées à une réservation donnée, sans colonne dédiée — même principe
  // que le marqueur d'alerte de maintenance préventive plus bas.
  try {
    const { data: enAttente } = await supabase
      .from('reservations')
      .select('id, ref, city_id, prenom, nom, email, tel, adresse, date_debut, date_fin, quantite, installation, prix_total_cents, statut, creneau, stripe_customer_id, created_at')
      .eq('statut', 'en_attente')
      .not('email', 'is', null);

    let relanceCount = 0, annuleCount = 0;
    if ((enAttente || []).length && process.env.STRIPE_SECRET_KEY) {
      const stripeRelance = new Stripe(process.env.STRIPE_SECRET_KEY);
      for (const resa of enAttente) {
        if (!resa.email) continue;
        const ageJours = Math.floor((today - new Date(resa.created_at)) / 86400000);
        if (ageJours < 1) continue;

        // Passé 7 jours sans paiement malgré les relances, on arrête les
        // frais : la réservation est annulée, plus aucune relance ne suit.
        if (ageJours >= 7) {
          await supabase.from('reservations').update({ statut: 'annulee' }).eq('id', resa.id);
          await pushToAdmin(supabase, {
            title: `⏳ Réservation annulée (jamais payée) — ${resa.ref || '?'}`,
            body:  `${resa.prenom || ''} ${resa.nom || ''} — en attente depuis ${ageJours}j sans paiement, annulée automatiquement.`,
            tag:   `en-attente-annulee-${resa.id}`,
          });
          annuleCount++;
          continue;
        }

        const { count: nbRelances } = await supabase
          .from('email_log').select('id', { count: 'exact', head: true })
          .eq('reservation_id', resa.id).eq('scenario', 'relance_paiement');

        // 1re relance à J+1, 2e à J+3 — jamais plus d'une relance par jour
        // (le compteur ne progresse qu'après un envoi réussi).
        const doitRelancer = (nbRelances === 0 && ageJours >= 1) || (nbRelances === 1 && ageJours >= 3);
        if (!doitRelancer) continue;

        const result = await sendReservationPaymentLink(supabase, stripeRelance, resa, { scenario: 'relance_paiement', rappel: true });
        if (result.ok) relanceCount++;
        else console.error('[Cron relance paiement]', result.error, 'reservation', resa.id);
      }
    }
    if (relanceCount) report.relancesPaiement = relanceCount;
    if (annuleCount) report.enAttenteAnnulees = annuleCount;
  } catch (e) {
    console.error('[Cron relances paiement]', e.message);
  }

  // ── 4. Maintenance préventive ─────────────────────────────────────────────────
  // Appareil ayant dépassé le seuil de locations → on demande à l'admin,
  // jamais de passage automatique en maintenance (retirer un climatiseur du
  // stock disponible a un vrai impact, ce n'est pas au cron de décider seul).
  // Le comptage total de locations d'un appareil ne redescend jamais — sans
  // garde-fou, la même question reviendrait chaque jour indéfiniment tant que
  // rien n'a changé : on ne redemande donc que si aucune alerte n'a encore
  // été envoyée depuis la dernière fois que l'appareil est revenu disponible.
  const ALERTE_MAINTENANCE_MARQUEUR = 'Seuil de maintenance standard atteint';
  try {
    const SEUIL = parseInt(process.env.MAINTENANCE_SEUIL) || 15;
    const { data: appareils } = await supabase
      .from('appareils').select('id, numero, city_id, localisation').eq('statut', 'disponible');

    let maintenanceCount = 0;
    for (const app of appareils || []) {
      const { count } = await supabase
        .from('reservation_appareils').select('id', { count: 'exact', head: true })
        .eq('appareil_id', app.id);
      if ((count || 0) < SEUIL) continue;

      const [{ data: derniereAlerte }, { data: dernierRetourDispo }] = await Promise.all([
        supabase.from('appareil_mouvements').select('created_at')
          .eq('appareil_id', app.id).eq('type_evenement', 'autre')
          .like('commentaire', `${ALERTE_MAINTENANCE_MARQUEUR}%`)
          .order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('appareil_mouvements').select('created_at')
          .eq('appareil_id', app.id).eq('nouveau_statut', 'disponible')
          .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      const dejaAlerte = derniereAlerte && (!dernierRetourDispo || derniereAlerte.created_at > dernierRetourDispo.created_at);
      if (dejaAlerte) continue;

      // Ne change ni le statut ni la localisation (nouveauStatut/nouvelleLocalisation
      // repassent la valeur déjà en place) : juste une trace pour ne pas
      // reposer la même question chaque jour.
      await recordMouvement(supabase, {
        appareilId: app.id, typeEvenement: 'autre', nouvelleLocalisation: app.localisation,
        utilisateur: 'systeme',
        commentaire: `${ALERTE_MAINTENANCE_MARQUEUR} (${count} locations, seuil ${SEUIL}).`,
      });
      await pushToAdmin(supabase, {
        title: `🔧 Climatiseur #${app.numero} — maintenance standard ?`,
        body:  `${count} locations effectuées. Fais la maintenance standard et garde-le disponible, ou passe-le en maintenance depuis le Stock.`,
        tag:   `maintenance-${app.id}`,
      });
      maintenanceCount++;
    }
    if (maintenanceCount) report.maintenance = maintenanceCount;
  } catch (e) {
    console.error('[Cron maintenance]', e.message);
  }

  // ── 4bis. Maintenance dépassée / appareil bloqué trop longtemps (Module 6,
  // Partie 12) ─────────────────────────────────────────────────────────────────
  // Un appareil en panne/maintenance/nettoyage depuis plus de X jours sans
  // avoir été résolu bloque du stock sans que personne ne s'en aperçoive.
  try {
    const SEUIL_JOURS = parseInt(process.env.MAINTENANCE_BLOQUEE_SEUIL_JOURS) || 7;
    const seuilDate = new Date(Date.now() - SEUIL_JOURS * 86400000).toISOString();
    const { data: bloques } = await supabase
      .from('appareils').select('id, numero, statut, city_id')
      .in('statut', ['panne', 'maintenance', 'nettoyage']);

    let bloqueCount = 0;
    for (const app of bloques || []) {
      // Dernier mouvement de CET appareil : depuis quand est-il dans cet état ?
      const { data: dernier } = await supabase
        .from('appareil_mouvements').select('created_at')
        .eq('appareil_id', app.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!dernier || dernier.created_at > seuilDate) continue;

      const joursBloque = Math.round((Date.now() - new Date(dernier.created_at).getTime()) / 86400000);
      await pushToAdmin(supabase, {
        title: `⏳ Appareil #${app.numero} bloqué depuis ${joursBloque}j`,
        body:  `Statut "${app.statut}" sans changement depuis ${joursBloque} jours — vérifie si une action est nécessaire.`,
        tag:   `bloque-${app.id}`,
      });
      bloqueCount++;
    }
    if (bloqueCount) report.appareils_bloques = bloqueCount;
  } catch (e) {
    console.error('[Cron appareils bloqués]', e.message);
  }

  // ── 4ter. Offre Privilège — Step 1 : détection d'éligibilité ─────────────────
  // Un climatiseur très loué, actuellement chez un client (réservation
  // confirmée dont la période couvre aujourd'hui), peut lui être proposé à
  // l'achat plutôt que récupéré. Ici : uniquement repérer et prévenir
  // l'admin — aucun prix fixé, aucune offre visible côté client, aucun
  // appareil marqué "vendu" (viendra dans une 2e étape).
  //
  // Si un client refuse, l'appareil reste éligible : le client suivant (et
  // tous les suivants) reçoit la même proposition à son tour, en milieu de
  // son propre séjour — jusqu'à ce que l'un d'eux accepte. Une fois accepté
  // une fois pour CET appareil, plus jamais reproposé.
  try {
    const SEUIL_OFFRE = parseInt(process.env.OFFRE_PRIVILEGE_SEUIL) || 30;
    const { data: liens } = await supabase
      .from('reservation_appareils')
      .select('appareil_id, reservation_id, reservation:reservations(statut, date_debut, date_fin)');
    const enLocation = new Map();
    for (const l of (liens || [])) {
      if (l.reservation && l.reservation.statut === 'confirmee'
        && l.reservation.date_debut <= todayStr && l.reservation.date_fin > todayStr) {
        enLocation.set(l.appareil_id, {
          reservationId: l.reservation_id,
          dateDebut: l.reservation.date_debut,
          dateFin: l.reservation.date_fin,
        });
      }
    }

    let offreCount = 0;
    for (const [appareilId, { reservationId, dateDebut, dateFin }] of enLocation) {
      // Milieu de séjour seulement : ni au tout début (le temps d'en
      // profiter un peu), ni tout à la fin (le temps de décider avant la
      // récupération prévue).
      const milieuStr = new Date((new Date(dateDebut).getTime() + new Date(dateFin).getTime()) / 2)
        .toISOString().slice(0, 10);
      if (todayStr < milieuStr) continue;

      const [{ count }, { data: appareilHist }] = await Promise.all([
        supabase.from('reservation_appareils').select('id', { count: 'exact', head: true }).eq('appareil_id', appareilId),
        supabase.from('appareils').select('nb_locations_historique').eq('id', appareilId).maybeSingle(),
      ]);
      // + nb_locations_historique : locations perdues du décompte "actuel"
      // par un échange/réaffectation passé (voir bumpNbLocationsHistorique
      // dans admin-stock.js) — sans ça un appareil souvent échangé
      // n'atteignait jamais le seuil malgré un usage réel suffisant.
      const totalLocations = (count || 0) + (appareilHist?.nb_locations_historique || 0);
      if (totalLocations < SEUIL_OFFRE) continue;

      const { data: offresAppareil } = await supabase
        .from('offres_privilege').select('reservation_id, statut').eq('appareil_id', appareilId);
      // Une fois acceptée par un client, plus jamais reproposée pour cet appareil.
      if ((offresAppareil || []).some(o => o.statut === 'acceptee')) continue;
      // Jamais deux fois pour la même location (mais reproposée au client
      // suivant si celui-ci a refusé — voir commentaire plus haut).
      if ((offresAppareil || []).some(o => o.reservation_id === reservationId)) continue;

      const { data: appareil } = await supabase.from('appareils').select('numero').eq('id', appareilId).maybeSingle();
      await supabase.from('offres_privilege').insert({
        appareil_id: appareilId, reservation_id: reservationId, nb_locations: totalLocations, statut: 'eligible',
      });
      await pushToAdmin(supabase, {
        title: `⭐ Climatiseur #${appareil?.numero} — Offre Privilège`,
        body:  `${totalLocations} locations effectuées, actuellement chez un client (milieu de séjour). Fixe un prix pour lui proposer de le garder.`,
        tag:   `offre-privilege-${appareilId}-${reservationId}`,
      });
      offreCount++;
    }
    if (offreCount) report.offres_privilege = offreCount;
  } catch (e) {
    console.error('[Cron offre privilège]', e.message);
  }

  // ── 5. Alerte stock saturé J+7 ───────────────────────────────────────────────
  // Aucun appareil disponible dans 7 jours → push admin.
  try {
    const { data: cities } = await supabase.from('cities').select('id, name').eq('actif', true);
    for (const city of cities || []) {
      const dispo = await getAvailability(supabase, city.id, in7dStr, in8dStr);
      if (dispo === 0) {
        await pushToAdmin(supabase, {
          title: `📦 Stock saturé dans 7 jours — ${city.name}`,
          body:  `Aucun appareil libre le ${in7dStr}. Pensez à activer le mode complet si nécessaire.`,
          tag:   `stock-sature-${city.id}-${in7dStr}`,
        });
        report.stockAlerte = (report.stockAlerte || 0) + 1;
      }
    }
  } catch (e) {
    console.error('[Cron stock alerte]', e.message);
  }

  // ── 5bis. Filet de sécurité : recalcul quotidien de sold_out ────────────────
  // _auto_sold_out (migration_auto_sold_out.sql) ne se relance que sur des
  // écritures (nouvelle réservation, appareil qui change de statut) — jamais
  // au simple passage de minuit. Une location qui se termine dans la nuit
  // sans qu'aucune autre écriture ne survienne ensuite peut laisser le site
  // bloqué sur "complet" plus longtemps que nécessaire. Ce passage quotidien
  // rattrape ce cas, ville par ville.
  try {
    const { data: citiesForSoldOut } = await supabase.from('cities').select('id').eq('actif', true);
    for (const city of citiesForSoldOut || []) {
      await supabase.rpc('_auto_sold_out', { p_city_id: city.id });
      await notifyIfSoldOut(supabase, city.id);
    }
  } catch (e) {
    console.error('[Cron sold_out refresh]', e.message);
  }

  // ── 6. Emails client automatisés (J-14, J-3, J-1, avant fin de location,
  // rappel récupération) — fenêtres dans _lib/emailSchedule.js, garantie
  // "jamais deux fois" + historique dans _lib/emailEngine.js. Les données de
  // la réservation sont relues ici, au moment de l'envoi, jamais figées à
  // l'avance. Les scénarios événementiels (confirmation, post-installation,
  // fin de location) se déclenchent ailleurs (webhook Stripe, actions
  // transporteur), pas dans cette boucle.
  try {
    const in14d = new Date(today); in14d.setDate(in14d.getDate() + 14);
    const in14dStr = in14d.toISOString().slice(0, 10);

    const { data: candidats } = await supabase
      .from('reservations')
      .select('id, statut, date_debut, date_fin')
      .eq('statut', 'confirmee')
      .lte('date_debut', in14dStr)
      .gte('date_fin', todayStr);

    let emailsEnvoyes = 0;
    for (const resa of candidats || []) {
      for (const scenario of scenariosDueToday(resa, todayStr)) {
        const result = await sendScenarioEmail(supabase, { reservationId: resa.id, scenario });
        if (result.sent) emailsEnvoyes++;
      }
    }
    if (emailsEnvoyes) report.emailsScenarios = emailsEnvoyes;
  } catch (e) {
    console.error('[Cron emails scénarios]', e.message);
  }

  // ── 6bis. Panneau Communications : alerte push si des anomalies restent à
  // traiter (email jamais parti alors que dû, ou dernier envoi en erreur —
  // même détection que le panneau admin, voir _lib/communicationsCockpit.js).
  // Tag fixe par ville : cette notification se met à jour à sa place au lieu
  // de s'empiler chaque jour tant que l'admin n'a pas traité les anomalies.
  try {
    const { data: citiesForComms } = await supabase.from('cities').select('id, name').eq('actif', true);
    for (const city of citiesForComms || []) {
      const { anomalies } = await buildCommunicationsCockpit(supabase, city.id);
      if (anomalies > 0) {
        await pushToAdmin(supabase, {
          title: `🎛️ ${anomalies} anomalie${anomalies > 1 ? 's' : ''} de communication — ${city.name}`,
          body:  "Email jamais parti ou en erreur pour au moins un client. Onglet Communications pour les traiter.",
          tag:   `communications-anomalies-${city.id}`,
        });
        report.communicationsAnomalies = (report.communicationsAnomalies || 0) + anomalies;
      }
    }
  } catch (e) {
    console.error('[Cron communications]', e.message);
  }

  // ── 7. Rapport hebdomadaire (lundi) et récap virements mensuel (le 1er) ─────
  // Un seul cron programmé sur ce plan Vercel (voir vercel.json) — ces deux
  // automatisations, jusque-là écrites mais jamais planifiées, se déclenchent
  // ici plutôt que sur leur propre entrée de cron.
  try {
    if (today.getDay() === 1) { // lundi
      report.weekly = await runWeeklyReport(supabase);
    }
  } catch (e) {
    console.error('[Cron weekly via daily]', e.message);
  }
  try {
    if (today.getDate() === 1) { // 1er du mois
      report.monthly = await runMonthlyRecap(supabase);
    }
  } catch (e) {
    console.error('[Cron monthly via daily]', e.message);
  }

  return res.status(200).json({ ok: true, date: todayStr, ...report });
};
