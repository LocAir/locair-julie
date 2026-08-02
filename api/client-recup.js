const { getSupabase } = require('./_lib/supabase');
const { verifyClientToken } = require('./_lib/auth');
const { fmtDate } = require('./_lib/emailEngine');
const { sendBrevoSms } = require('./_lib/brevo');
const { notifyTransporteur } = require('./_lib/transporteurNotif');
const { pushToAdmin } = require('./_lib/push');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();

  const reservationId = await verifyClientToken(req, supabase);
  if (!reservationId) return res.status(401).json({ error: 'Non autorisé' });

  const body = req.body || {};

  if (body.action !== 'request_early_recup') {
    return res.status(400).json({ error: 'Action inconnue' });
  }

  const newDate = (body.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    return res.status(400).json({ error: 'Date invalide' });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (newDate < today) {
    return res.status(400).json({ error: 'La date ne peut pas être dans le passé' });
  }

  try {
    const { data: liv, error: livErr } = await supabase
      .from('livraisons')
      .select('id, date_prevue, creneau, statut, transporteur_id')
      .eq('reservation_id', reservationId)
      .eq('type', 'recuperation')
      .not('statut', 'in', '(annulee,annule,refusee,fait)')
      .maybeSingle();
    if (livErr) throw livErr;
    if (!liv) return res.status(404).json({ error: 'Aucune récupération à venir trouvée' });

    if (newDate >= liv.date_prevue) {
      return res.status(400).json({ error: 'La nouvelle date doit être antérieure à la date actuelle de récupération' });
    }

    const { error: updateErr } = await supabase
      .from('livraisons')
      .update({ date_prevue: newDate })
      .eq('id', liv.id);
    if (updateErr) throw updateErr;

    const { data: resa } = await supabase
      .from('reservations')
      .select('tel, lang, prenom, ref')
      .eq('id', reservationId)
      .maybeSingle();

    // SMS de confirmation au client
    if (resa?.tel) {
      const lg = resa.lang || 'fr';
      const dateFmt = fmtDate(newDate, lg);
      let content;
      if (lg === 'en') {
        content = `Loc'Air - Your collection has been brought forward to ${dateFmt}${liv.creneau ? ', time slot ' + liv.creneau : ''}. The time slot is unchanged. Questions? Call us at +33 6 63 79 87 56.`;
      } else if (lg === 'zh') {
        content = `Loc'Air - 您的取回日期已提前至${dateFmt}${liv.creneau ? '，时间段：' + liv.creneau : ''}。时间段不变。如有疑问，请致电 +33 6 63 79 87 56。`;
      } else if (lg === 'ru') {
        content = `Loc'Air - Возврат перенесён на ${dateFmt}${liv.creneau ? ', интервал ' + liv.creneau : ''}. Интервал остаётся прежним. Вопросы? +33 6 63 79 87 56.`;
      } else {
        content = `Loc'Air - Votre récupération a été avancée au ${dateFmt}${liv.creneau ? ', créneau ' + liv.creneau : ''}. Le créneau reste inchangé. Une question ? Appelez-nous au 06 63 79 87 56.`;
      }
      const result = await sendBrevoSms({ to: resa.tel, content });
      await supabase.from('email_log').insert({
        reservation_id: reservationId, scenario: 'sms_recuperation_reprogrammee', canal: 'sms',
        destinataire: resa.tel, modele: 'sms_recuperation_reprogrammee',
        statut: result.ok ? 'envoye' : 'erreur',
        erreur: result.ok ? null : String(result.error || '').slice(0, 500),
        contenu: content,
      }).then(() => {}, () => {});
    }

    // Notification push au transporteur si déjà assigné
    if (liv.transporteur_id) {
      await notifyTransporteur(supabase, liv.transporteur_id, {
        type: 'autre',
        message: `La récupération du dossier ${resa?.ref || ''} a été avancée au ${fmtDate(newDate, 'fr')} par le client.`,
        livraisonId: liv.id,
        tag: `recup-avancee-${liv.id}`,
      }).catch(e => console.error('[client-recup notif transporteur]', e.message));
    }

    // Notification push à l'admin
    await pushToAdmin(supabase, {
      title: `📅 Récupération avancée — ${resa?.ref || 'dossier ' + reservationId}`,
      body: `${resa?.prenom || 'Un client'} a avancé sa récupération au ${fmtDate(newDate, 'fr')}.`,
      tag: `recup-avancee-${liv.id}`,
    });

    // Réinitialise l'idempotence : la nouvelle date doit déclencher le rappel
    // J-1 et la demande d'avis Google à nouveau sur la nouvelle date.
    await supabase.from('email_log')
      .delete()
      .eq('reservation_id', reservationId)
      .in('scenario', ['sms_rappel_recuperation', 'sms_avis_google'])
      .then(() => {}, e => console.error('[client-recup reset SMS idempotence]', e.message));

    return res.status(200).json({ ok: true, date_prevue: newDate });
  } catch (e) {
    console.error('[client-recup]', e.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
