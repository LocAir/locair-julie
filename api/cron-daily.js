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
const { recordMouvement } = require('./_lib/stockMouvements');

function verifyCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
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

        const amountCents     = calcRetardPrice(joursRetard) * 100;
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

  // ── 4. Maintenance préventive ─────────────────────────────────────────────────
  // Appareil ayant dépassé le seuil de locations → passage auto en maintenance.
  try {
    const SEUIL = parseInt(process.env.MAINTENANCE_SEUIL) || 15;
    const { data: appareils } = await supabase
      .from('appareils').select('id, numero, city_id').eq('statut', 'disponible');

    let maintenanceCount = 0;
    for (const app of appareils || []) {
      const { count } = await supabase
        .from('reservation_appareils').select('id', { count: 'exact', head: true })
        .eq('appareil_id', app.id);
      if ((count || 0) < SEUIL) continue;

      // Mouvement de stock (Module 6, Partie 5) : même passage automatique,
      // toujours journalisé plutôt qu'un update() muet.
      await recordMouvement(supabase, {
        appareilId: app.id, typeEvenement: 'passage_maintenance', nouveauStatut: 'maintenance',
        nouvelleLocalisation: 'maintenance', utilisateur: 'systeme',
        commentaire: `Maintenance préventive après ${count} locations (seuil ${SEUIL}).`,
      });
      await pushToAdmin(supabase, {
        title: `🔧 Maintenance — Appareil #${app.numero}`,
        body:  `${count} locations effectuées. L'appareil est passé en maintenance préventive.`,
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
