const { getSupabase } = require('./_lib/supabase');
const { sendBrevoSms } = require('./_lib/brevo');

function verifyCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers['authorization'] || '') === `Bearer ${secret}`;
}

// Envoyé le soir de la récupération (18h30 heure de Paris) — le client
// vient de rendre l'appareil, c'est le moment idéal pour lui demander son
// avis Google. Idempotent : ne renvoie jamais deux fois pour la même
// réservation (scénario 'sms_avis_google' dans email_log).
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Non autorisé' });

  const supabase = getSupabase();
  const today = new Date().toISOString().slice(0, 10);

  const { data: recups } = await supabase
    .from('livraisons')
    .select('id, reservation_id, reservation:reservations(prenom, tel, lang)')
    .eq('type', 'recuperation')
    .eq('statut', 'fait')
    .gte('fait_at', today + 'T00:00:00.000Z')
    .lt('fait_at', today + 'T23:59:59.999Z');

  let sent = 0;
  for (const liv of recups || []) {
    const resa = liv.reservation;
    if (!resa?.tel) continue;

    const { data: dejaEnvoye } = await supabase.from('email_log')
      .select('id').eq('reservation_id', liv.reservation_id)
      .eq('scenario', 'sms_avis_google').eq('statut', 'envoye').maybeSingle();
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

    if (result.ok) sent++;
  }

  return res.status(200).json({ ok: true, sent });
};
