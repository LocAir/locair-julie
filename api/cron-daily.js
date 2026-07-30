const Stripe = require('stripe');
const { getSupabase }          = require('./_lib/supabase');
const { sendBrevoSms }         = require('./_lib/brevo');
const { pushToAdmin, pushToTransporteur } = require('./_lib/push');
const { getAvailability }      = require('./_lib/stock');
const { notifyIfSoldOut }      = require('./_lib/city');
const { runWeeklyReport }      = require('./cron-weekly');
const { runMonthlyRecap, runDormantClientsWinback } = require('./cron-monthly');
const { dailyRate } = require('./_lib/pricing');
const { scenariosDueToday, daysDiff, isSupersededReservation } = require('./_lib/emailSchedule');
const { sendScenarioEmail } = require('./_lib/emailEngine');
const { buildCommunicationsCockpit } = require('./_lib/communicationsCockpit');
const { recordMouvement } = require('./_lib/stockMouvements');
const { sendReservationPaymentLink } = require('./_lib/paymentLink');
const { sendRelanceProlongationSms, sendRappelRecuperationSms } = require('./_lib/reservations');
const { INCIDENT_OPEN_STATUSES } = require('./_lib/incidentStatus');

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

  // ── 2bis. Mission assignée à un transporteur, mais jamais acceptée par lui ──
  // Le bloc 2 ci-dessus ne détecte que l'absence de transporteur. Si Aly a
  // bien assigné quelqu'un mais que ce transporteur n'ouvre jamais l'app
  // (mission restée a_faire, jamais acceptée), rien ne le signalait
  // jusqu'ici — Aly ne l'apprenait que le jour même, parfois trop tard.
  // Même horizon que le bloc 2 (aujourd'hui/demain) pour ne jamais faire
  // doublon avec l'alerte "retard" ci-dessous, qui couvre déjà le cas où la
  // date prévue est passée.
  try {
    const { data: nonAcceptees } = await supabase
      .from('livraisons')
      .select('id, date_prevue, type, transporteur:transporteurs(nom)')
      .eq('statut', 'a_faire')
      .not('transporteur_id', 'is', null)
      .is('accepted_at', null)
      .gte('date_prevue', todayStr)
      .lte('date_prevue', tomorrowStr);

    let nonAccepteeCount = 0;
    for (const liv of nonAcceptees || []) {
      await pushToAdmin(supabase, {
        title: `⏰ Mission non acceptée — ${liv.transporteur?.nom || '?'}`,
        body:  `Mission du ${liv.date_prevue} assignée mais toujours pas acceptée — vérifie que le transporteur l'a bien vue.`,
        tag:   `non-acceptee-${liv.id}`,
      });
      nonAccepteeCount++;
    }
    if (nonAccepteeCount) report.missionsNonAcceptees = nonAccepteeCount;
  } catch (e) {
    console.error('[Cron missions non acceptées]', e.message);
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
        if (!methods.data.length) {
          // Jusqu'ici silencieux : le système pouvait laisser croire à Aly
          // qu'il gérait le retard tout seul, alors qu'aucune carte n'est
          // enregistrée pour ce client — aucun prélèvement ne partira jamais.
          await pushToAdmin(supabase, {
            title: `❌ Retard non facturable — ${resa.nom || '?'}`,
            body:  `Aucune carte enregistrée pour ce client — le prélèvement automatique de retard est impossible. Contacte-le manuellement.`,
            tag:   `retard-non-facturable-${liv.id}-${todayStr}`,
          });
          continue;
        }

        const amountCents     = dailyRate(joursRetard) * 100;
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
        // Jusqu'ici, un prélèvement refusé (carte expirée, plafond atteint...)
        // ne se voyait que dans les logs Vercel — Aly pouvait croire que le
        // système avait bien récupéré l'argent alors que rien n'a été
        // prélevé. Alerte explicite + trace en incident pour un suivi manuel.
        await pushToAdmin(supabase, {
          title: `❌ Prélèvement retard échoué — ${resa.nom || '?'}`,
          body:  `Le prélèvement automatique de ${joursRetard}j de retard a échoué (${(stripeErr.message || 'carte refusée').slice(0, 200)}). Contacte le client pour régulariser manuellement.`,
          tag:   `retard-stripe-echec-${liv.id}-${todayStr}`,
        });
        await supabase.from('incidents').insert({
          city_id:               resa.city_id || null,
          reservation_id:        liv.reservation_id,
          type:                  'retard',
          description:           `Prélèvement automatique de retard échoué (${joursRetard}j) : ${(stripeErr.message || '').slice(0, 300)}`,
          montant_facture_cents: dailyRate(joursRetard) * 100,
          statut:                'nouveau',
        }).catch(e2 => console.error('[Cron retard Stripe incident]', e2.message));
      }
    }
    if (retardCount) report.retards = retardCount;
  } catch (e) {
    console.error('[Cron retards]', e.message);
  }

  // ── Retards de livraison (parallèle au bloc 3 ci-dessus) ─────────────
  // Seule la récupération en retard était détectée — une livraison jamais
  // effectuée (client sans climatiseur, technicien qui n'y est jamais allé)
  // n'était jusqu'ici découverte que si le client appelait lui-même. Pas de
  // prélèvement automatique ici : ça ne concerne que le retard de
  // restitution à la récupération (voir bloc 3).
  try {
    const { data: retardsLivraison } = await supabase
      .from('livraisons')
      .select('id, date_prevue, reservation:reservations(ref, nom)')
      .eq('type', 'livraison')
      .in('statut', ['a_faire', 'acceptee'])
      .lt('date_prevue', todayStr);

    let retardLivraisonCount = 0;
    for (const liv of retardsLivraison || []) {
      const joursRetard = Math.round((new Date(todayStr) - new Date(liv.date_prevue)) / 86400000);
      const resa = liv.reservation || {};
      await pushToAdmin(supabase, {
        title: `🚨 Retard livraison — ${resa.nom || '?'} (${joursRetard}j)`,
        body:  `Livraison prévue le ${liv.date_prevue}, non effectuée. Dossier ${resa.ref || '?'}.`,
        tag:   `retard-livraison-${liv.id}`,
      });
      retardLivraisonCount++;
    }
    if (retardLivraisonCount) report.retardsLivraison = retardLivraisonCount;
  } catch (e) {
    console.error('[Cron retards livraison]', e.message);
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
      .select('id, ref, city_id, prenom, nom, email, tel, adresse, date_debut, date_fin, quantite, installation, prix_total_cents, statut, creneau, stripe_customer_id, stripe_payment_intent_id, created_at, source, lang, reservation_origine_id')
      .eq('statut', 'en_attente')
      .or('email.not.is.null,tel.not.is.null');

    let relanceCount = 0, annuleCount = 0;
    if ((enAttente || []).length && process.env.STRIPE_SECRET_KEY) {
      const stripeRelance = new Stripe(process.env.STRIPE_SECRET_KEY);
      for (const resa of enAttente) {
        if (!resa.email && !resa.tel) continue;
        const ageJours = Math.floor((today - new Date(resa.created_at)) / 86400000);
        if (ageJours < 1) continue;

        // Passé 7 jours sans paiement malgré les relances, on arrête les
        // frais : la réservation est annulée, plus aucune relance ne suit.
        if (ageJours >= 7) {
          // .select('id') + vérification du nombre de lignes : si un paiement
          // vient de réussir pile au moment où ce cron tourne (webhook Stripe
          // concurrent), la réservation n'est déjà plus 'en_attente' et cette
          // mise à jour ne touche aucune ligne — sans ce contrôle, le code
          // annulait quand même le PaymentIntent et poussait à Aly une fausse
          // alerte "jamais payée" pour une réservation qui vient d'être payée.
          const { data: annulee } = await supabase
            .from('reservations').update({ statut: 'annulee' }).eq('id', resa.id).eq('statut', 'en_attente').select('id');
          if (!annulee || !annulee.length) continue;
          if (resa.stripe_payment_intent_id) {
            await stripeRelance.paymentIntents.cancel(resa.stripe_payment_intent_id).catch(e =>
              console.error('[Cron annulation PI cancel]', resa.stripe_payment_intent_id, e.message)
            );
          }
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
          .eq('reservation_id', resa.id).eq('scenario', 'relance_paiement').eq('statut', 'envoye');

        // 1re relance à J+1, 2e à J+3 — jamais plus d'une relance par jour
        // (le compteur ne progresse qu'après un envoi réussi : un échec Brevo
        // ponctuel — quota, 5xx — ne doit pas bloquer la relance suivante, ni
        // faire annuler la réservation à J+7 alors qu'aucun lien n'est
        // jamais arrivé au client).
        const doitRelancer = (nbRelances === 0 && ageJours >= 1) || (nbRelances === 1 && ageJours >= 3);
        if (!doitRelancer) continue;

        const result = await sendReservationPaymentLink(supabase, stripeRelance, resa, { scenario: 'relance_paiement', rappel: true, preferSms: true });
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
      // Try/catch PAR appareil : recordMouvement relance une exception sur
      // erreur DB (ex. panne transitoire Supabase) — sans ce filet, un seul
      // appareil en échec coupait la vérification de TOUS les appareils
      // suivants de la liste ce jour-là, silencieusement (seul le compteur
      // 'catch' englobant plus bas aurait loggé, sans jamais reprendre).
      try {
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
      } catch (e) {
        console.error(`[Cron maintenance] appareil #${app.id}`, e.message);
      }
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

  // ── 4quater. Incidents ouverts sans suite depuis trop longtemps ────────────
  // Un incident 'nouveau'/'en_analyse' (y compris celui créé automatiquement
  // quand un transporteur signale un problème sur une mission — client
  // absent, accès impossible... voir transporteur-action.js) ne remontait
  // jusqu'ici que dans un chiffre global du rapport hebdomadaire du lundi :
  // jamais signalé individuellement. Un incident oublié depuis 3 semaines
  // pouvait donc rester invisible entre deux lundis.
  try {
    const SEUIL_INCIDENT_JOURS = parseInt(process.env.INCIDENT_ANCIEN_SEUIL_JOURS) || 3;
    const seuilIncidentDate = new Date(Date.now() - SEUIL_INCIDENT_JOURS * 86400000).toISOString();
    const { data: incidentsAnciens } = await supabase
      .from('incidents')
      .select('id, type, created_at, reservation:reservations(ref, nom)')
      .in('statut', INCIDENT_OPEN_STATUSES)
      .lt('created_at', seuilIncidentDate);

    let incidentAncienCount = 0;
    for (const inc of incidentsAnciens || []) {
      const joursOuvert = Math.round((Date.now() - new Date(inc.created_at).getTime()) / 86400000);
      const resa = inc.reservation || {};
      await pushToAdmin(supabase, {
        title: `🧯 Incident ouvert depuis ${joursOuvert}j — ${resa.nom || '?'}`,
        body:  `Type "${inc.type}", dossier ${resa.ref || '?'} — toujours sans suite depuis ${joursOuvert} jours.`,
        tag:   `incident-ancien-${inc.id}`,
      });
      incidentAncienCount++;
    }
    if (incidentAncienCount) report.incidentsAnciens = incidentAncienCount;
  } catch (e) {
    console.error('[Cron incidents anciens]', e.message);
  }

  // ── 4quinquies. Virements transporteur en attente depuis trop longtemps ────
  // Visible jusqu'ici seulement en agrégat dans le rapport hebdomadaire du
  // lundi — un transporteur qui demandait un virement le mardi pouvait
  // attendre presque une semaine avant qu'Aly ne le remarque.
  try {
    const SEUIL_VIREMENT_JOURS = parseInt(process.env.VIREMENT_ANCIEN_SEUIL_JOURS) || 3;
    const seuilVirementDate = new Date(Date.now() - SEUIL_VIREMENT_JOURS * 86400000).toISOString();
    const { data: virementsAnciens } = await supabase
      .from('virements')
      .select('id, montant_cents, created_at, transporteur:transporteurs(nom)')
      .eq('statut', 'demande')
      .lt('created_at', seuilVirementDate);

    let virementAncienCount = 0;
    for (const v of virementsAnciens || []) {
      const joursAttente = Math.round((Date.now() - new Date(v.created_at).getTime()) / 86400000);
      await pushToAdmin(supabase, {
        title: `💶 Virement en attente depuis ${joursAttente}j — ${v.transporteur?.nom || '?'}`,
        body:  `Demande de ${(v.montant_cents / 100).toFixed(2)} € toujours pas versée.`,
        tag:   `virement-ancien-${v.id}`,
      });
      virementAncienCount++;
    }
    if (virementAncienCount) report.virementsAnciens = virementAncienCount;
  } catch (e) {
    console.error('[Cron virements anciens]', e.message);
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
      // Try/catch PAR ville : getAvailability relance une exception sur
      // erreur DB — sans ce filet, une erreur transitoire sur UNE ville
      // coupait l'alerte pour toutes les villes suivantes de la liste ce
      // jour-là (silencieux, l'admin ne voit jamais qu'il en manque).
      try {
        const dispo = await getAvailability(supabase, city.id, in7dStr, in8dStr);
        if (dispo === 0) {
          await pushToAdmin(supabase, {
            title: `📦 Stock saturé dans 7 jours — ${city.name}`,
            body:  `Aucun appareil libre le ${in7dStr}. Pensez à activer le mode complet si nécessaire.`,
            tag:   `stock-sature-${city.id}-${in7dStr}`,
          });
          report.stockAlerte = (report.stockAlerte || 0) + 1;
        }
      } catch (e) {
        console.error(`[Cron stock alerte] ville #${city.id}`, e.message);
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
      .select('id, statut, date_debut, date_fin, prenom, tel, ref, lang, email, city_id, source, reservation_origine_id')
      .eq('statut', 'confirmee')
      .lte('date_debut', in14dStr)
      .gte('date_fin', todayStr);

    // Regroupe par client (même ville + même email) pour détecter les fiches
    // supplantées par une prolongation plus récente — voir isSupersededReservation
    // (_lib/emailSchedule.js). Sans ça, une réservation "d'origine" restée
    // 'confirmee' pour toujours après une prolongation recevrait les mêmes
    // rappels une seconde fois, en double de ceux déjà envoyés pour la
    // prolongation qui la remplace réellement.
    const peersByKey = {};
    for (const r of candidats || []) {
      const key = `${r.city_id}:${String(r.email || '').toLowerCase()}`;
      (peersByKey[key] = peersByKey[key] || []).push(r);
    }

    let emailsEnvoyes = 0;
    let smsRelanceProlongation = 0;
    let smsRappelRecuperation = 0;
    for (const resa of candidats || []) {
      const peers = peersByKey[`${resa.city_id}:${String(resa.email || '').toLowerCase()}`];
      if (isSupersededReservation(resa, peers)) continue;
      const scenariosDus = scenariosDueToday(resa, todayStr);
      for (const scenario of scenariosDus) {
        const result = await sendScenarioEmail(supabase, { reservationId: resa.id, scenario });
        if (result.sent) emailsEnvoyes++;
      }
      // SMS de relance prolongation : 4 jours avant la fin de location,
      // uniquement pour les locations de plus de 4 jours (sinon dFin===4
      // tomberait le jour même de la livraison — même garde que
      // avant_fin_location dans _lib/emailSchedule.js). Idempotent sur son
      // propre scénario (sms_relance_prolongation), voir _lib/reservations.js.
      try {
        const duree = daysDiff(resa.date_debut, resa.date_fin);
        const dFin = daysDiff(todayStr, resa.date_fin);
        if (duree > 4 && dFin === 4) {
          await sendRelanceProlongationSms(supabase, resa);
          smsRelanceProlongation++;
        }
      } catch (e) {
        console.error('[Cron SMS relance prolongation]', e.message);
      }
      // SMS rappel récupération : même jour que l'email rappel_recuperation
      // (le jour de date_fin, annonçant un passage le lendemain). Idempotent
      // sur son propre scénario (sms_rappel_recuperation), voir _lib/reservations.js.
      if (scenariosDus.includes('rappel_recuperation')) {
        try {
          await sendRappelRecuperationSms(supabase, resa);
          smsRappelRecuperation++;
        } catch (e) {
          console.error('[Cron SMS rappel récupération]', e.message);
        }
      }
    }
    if (emailsEnvoyes) report.emailsScenarios = emailsEnvoyes;
    if (smsRelanceProlongation) report.smsRelanceProlongation = smsRelanceProlongation;
    if (smsRappelRecuperation) report.smsRappelRecuperation = smsRappelRecuperation;
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

  // ── 6ter. Récap quotidien des communications envoyées aux clients (email +
  // SMS, tous scénarios confondus) — pour que l'admin soit alerté chaque jour
  // de ce qui est réellement parti, sans avoir à aller vérifier lui-même.
  // Fenêtre glissante de 24h (le cron ne tourne qu'une fois par jour, voir
  // vercel.json) ; tag daté (pas comme le tag "anomalies" ci-dessus) car
  // c'est un événement distinct chaque jour, pas un état à mettre à jour.
  try {
    const depuis24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: logsRecap } = await supabase
      .from('email_log')
      .select('canal, statut, reservation:reservations!inner(city_id)')
      .gte('created_at', depuis24h);
    const parVille = {};
    for (const log of logsRecap || []) {
      const cid = log.reservation?.city_id;
      if (!cid) continue;
      const s = (parVille[cid] = parVille[cid] || { total: 0, email: 0, sms: 0, erreurs: 0 });
      s.total++;
      if (log.canal === 'sms') s.sms++; else s.email++;
      if (log.statut === 'erreur') s.erreurs++;
    }
    const { data: citiesForRecap } = await supabase.from('cities').select('id, name').eq('actif', true);
    for (const city of citiesForRecap || []) {
      const s = parVille[city.id];
      if (!s || !s.total) continue;
      await pushToAdmin(supabase, {
        title: `📨 Communications d'hier — ${city.name}`,
        body:  `${s.total} envoi${s.total > 1 ? 's' : ''} (${s.email} email${s.email > 1 ? 's' : ''}, ${s.sms} SMS)${s.erreurs ? ` · ${s.erreurs} échec${s.erreurs > 1 ? 's' : ''} à vérifier` : ''}.`,
        tag:   `recap-communications-${city.id}-${todayStr}`,
      });
      report.recapCommunications = (report.recapCommunications || 0) + s.total;
    }
  } catch (e) {
    console.error('[Cron récap communications]', e.message);
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
  try {
    if (today.getDate() === 1) { // 1er du mois — même cadence que le récap virements
      report.dormants = await runDormantClientsWinback(supabase);
    }
  } catch (e) {
    console.error('[Cron dormants via daily]', e.message);
  }

  return res.status(200).json({ ok: true, date: todayStr, ...report });
};
