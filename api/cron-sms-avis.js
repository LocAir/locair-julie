const { getSupabase } = require('./_lib/supabase');
const { sendBrevoSms } = require('./_lib/brevo');
const { daysDiff, isSupersededReservation } = require('./_lib/emailSchedule');
const { sendRelanceProlongationSms } = require('./_lib/reservations');

function verifyCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers['authorization'] || '') === `Bearer ${secret}`;
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
  const today = new Date().toISOString().slice(0, 10);

  let sentAvis = 0;
  try {
    const { data: recups, error: recupsErr } = await supabase
      .from('livraisons')
      .select('id, reservation_id, reservation:reservations(prenom, tel, lang)')
      .eq('type', 'recuperation')
      .eq('statut', 'fait')
      .gte('fait_at', today + 'T00:00:00.000Z')
      .lt('fait_at', today + 'T23:59:59.999Z');
    if (recupsErr) throw recupsErr;

    for (const liv of recups || []) {
      const resa = liv.reservation;
      if (!resa?.tel) continue;

      const { data: dejaEnvoye, error: idempErr } = await supabase.from('email_log')
        .select('id').eq('reservation_id', liv.reservation_id)
        .eq('scenario', 'sms_avis_google').eq('statut', 'envoye').maybeSingle();
      if (idempErr) { console.error('[cron-sms-avis] Erreur idempotence:', idempErr.message); continue; }
      if (dejaEnvoye) continue;

      const lang = resa.lang || 'fr';
      let content;
      if (lang === 'en') {
        content = `Loc'Air — Thank you ${resa.prenom || ''}! Your experience helps future customers choose with confidence — share it in 1 click: g.page/r/CeJQrt2gLNNrEAE/review`;
      } else if (lang === 'zh') {
        content = `Loc'Air — 感谢 ${resa.prenom || ''}！您的体验将帮助未来的客户做出明智选择，一键分享：g.page/r/CeJQrt2gLNNrEAE/review`;
      } else if (lang === 'ru') {
        content = `Loc'Air — Спасибо, ${resa.prenom || ''}! Ваш отзыв поможет будущим клиентам — поделитесь в 1 клик: g.page/r/CeJQrt2gLNNrEAE/review`;
      } else {
        content = `Loc'Air — Merci ${resa.prenom || ''} ! Votre expérience guide les prochains clients — partagez-la en 1 clic : g.page/r/CeJQrt2gLNNrEAE/review`;
      }

      const result = await sendBrevoSms({ to: resa.tel, content });
      await supabase.from('email_log').insert({
        reservation_id: liv.reservation_id, scenario: 'sms_avis_google', canal: 'sms',
        destinataire: resa.tel, modele: 'sms_avis_google',
        statut: result.ok ? 'envoye' : 'erreur',
        erreur: result.ok ? null : String(result.error || '').slice(0, 500),
        contenu: content,
      }).then(() => {}, () => {});

      if (result.ok) sentAvis++;
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
      .select('id, statut, date_debut, date_fin, prenom, tel, ref, lang, email, city_id')
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
