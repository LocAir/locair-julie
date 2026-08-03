const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendBrevoSms } = require('./_lib/brevo');
const { daysDiff, isSupersededReservation } = require('./_lib/emailSchedule');
const { sendRelanceProlongationSms } = require('./_lib/reservations');
const { wasScenarioSkipped } = require('./_lib/emailEngine');

function verifyCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = req.headers['authorization'] || '';
  const expected = `Bearer ${secret}`;
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// Cron du soir (18h30 heure de Paris) — regroupe les 2 SMS dont le moment
// d'envoi compte plus que la précision à la minute : le client les lit
// bien mieux en soirée qu'en pleine journée de travail. Un seul cron
// (au lieu de deux) car le plan Vercel de Loc'Air n'en autorise que 2 au
// total (voir vercel.json) — celui-ci est déjà le 2e, à côté de
// cron-daily.js le matin.
//
// 1. Avis Google, le soir même de la récupération.
// 2. Relance prolongation, 4 jours avant la fin d'une location — déplacée
//    ici depuis cron-daily.js (8h30) à la demande d'Aly, pour un envoi en
//    soirée plutôt qu'en matinée.
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Non autorisé' });

  const supabase = getSupabase();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  let sentAvis = 0;
  try {
    const { data: recups, error: recupsErr } = await supabase
      .from('livraisons')
      .select('id, reservation_id, reservation:reservations(prenom, tel, lang, statut)')
      .eq('type', 'recuperation')
      .eq('statut', 'fait')
      .gte('fait_at', since);
    if (recupsErr) throw recupsErr;

    for (const liv of recups || []) {
      const resa = liv.reservation;
      if (!resa?.tel) continue;
      // La récupération a bien eu lieu, mais la réservation a pu être
      // annulée/remboursée après coup (litige — voir livraisonDejaFaite dans
      // admin-reservations.js, qui gère explicitement ce cas) : pas
      // opportun de demander un avis Google à un client qu'on vient de
      // rembourser pour un problème.
      if (['annulee', 'remboursee'].includes(resa.statut)) continue;
      if (await wasScenarioSkipped(supabase, liv.reservation_id, 'sms_avis_google')) continue;

      const lang = resa.lang || 'fr';
      let content;
      if (lang === 'en') {
        content = `Loc'Air — Thank you ${resa.prenom || ''}! Help us earn the trust of future customers — share your experience in 1 click: g.page/r/CeJQrt2gLNNrEAE/review`;
      } else if (lang === 'zh') {
        content = `Loc'Air — 感谢 ${resa.prenom || ''}！帮助我们赢得未来客户的信任——一键分享您的体验：g.page/r/CeJQrt2gLNNrEAE/review`;
      } else if (lang === 'ru') {
        content = `Loc'Air — Спасибо, ${resa.prenom || ''}! Помогите нам заслужить доверие будущих клиентов — поделитесь опытом в 1 клик: g.page/r/CeJQrt2gLNNrEAE/review`;
      } else {
        content = `Loc'Air — Merci ${resa.prenom || ''} ! Aidez-nous à gagner la confiance des futurs clients : partagez votre expérience en 1 clic : g.page/r/CeJQrt2gLNNrEAE/review`;
      }

      const { error: lockErr } = await supabase.from('email_sent')
        .insert({ reservation_id: liv.reservation_id, scenario: 'sms_avis_google', sent_at: new Date().toISOString() });
      if (lockErr) continue;

      const result = await sendBrevoSms({ to: resa.tel, content });

      if (!result.ok) {
        await supabase.from('email_sent').delete()
          .eq('reservation_id', liv.reservation_id).eq('scenario', 'sms_avis_google').then(() => {}, () => {});
        await supabase.from('email_log').insert({
          reservation_id: liv.reservation_id, scenario: 'sms_avis_google', canal: 'sms',
          destinataire: resa.tel, modele: 'sms_avis_google',
          statut: 'erreur', erreur: String(result.error || '').slice(0, 500), contenu: content,
        }).then(() => {}, () => {});
        continue;
      }

      await supabase.from('email_log').insert({
        reservation_id: liv.reservation_id, scenario: 'sms_avis_google', canal: 'sms',
        destinataire: resa.tel, modele: 'sms_avis_google',
        statut: 'envoye', erreur: null, contenu: content,
      }).then(() => {}, () => {});

      sentAvis++;
    }
  } catch (e) {
    console.error('[cron-sms-avis] Erreur Supabase requête principale:', e.message);
  }

  // Relance prolongation : réservations confirmées dont la fin de location
  // tombe dans exactement 4 jours, pour une location de plus de 4 jours
  // (sinon dFin===4 tomberait le jour même de la livraison — même garde
  // qu'avant son déplacement depuis cron-daily.js). Idempotent sur son
  // propre scénario (sms_relance_prolongation), voir _lib/reservations.js.
  let sentProlongation = 0;
  try {
    const cible = new Date(); cible.setUTCDate(cible.getUTCDate() + 4);
    const cibleStr = cible.toISOString().slice(0, 10);

    const { data: candidats, error: candErr } = await supabase
      .from('reservations')
      // source + reservation_origine_id : indispensables à
      // isSupersededReservation ci-dessous (oubliés lors du déplacement de
      // ce SMS depuis cron-daily.js, qui les sélectionne bien) — sans eux,
      // une réservation déjà supplantée par une prolongation plus récente
      // n'est jamais reconnue comme telle.
      .select('id, statut, date_debut, date_fin, prenom, tel, ref, lang, email, city_id, source, reservation_origine_id')
      .eq('statut', 'confirmee')
      .eq('date_fin', cibleStr);
    if (candErr) throw candErr;

    for (const resa of candidats || []) {
      if (daysDiff(resa.date_debut, resa.date_fin) <= 4) continue;

      // Écarte une fiche "d'origine" supplantée par une prolongation déjà
      // confirmée qui repousse la vraie fin de contrat plus loin dans le
      // temps — sans quoi ce SMS partirait à tort à un client qui a déjà
      // prolongé (voir isSupersededReservation, _lib/emailSchedule.js).
      const { data: peers } = await supabase
        .from('reservations').select('id, statut, date_debut, date_fin, reservation_origine_id')
        .eq('city_id', resa.city_id).ilike('email', resa.email || '').eq('statut', 'confirmee');
      if (isSupersededReservation(resa, peers || [])) continue;

      const result = await sendRelanceProlongationSms(supabase, resa);
      if (result.sent) sentProlongation++;
    }
  } catch (e) {
    console.error('[cron-sms-avis] Erreur relance prolongation:', e.message);
  }

  return res.status(200).json({ ok: true, sent: sentAvis, sentAvis, sentProlongation });
};
