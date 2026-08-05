const { getSupabase } = require('./_lib/supabase');
const { verifyClientToken } = require('./_lib/auth');
const { fmtDate } = require('./_lib/emailEngine');
const { sendBrevoSms } = require('./_lib/brevo');
const { notifyTransporteur } = require('./_lib/transporteurNotif');
const { pushToAdmin } = require('./_lib/push');
const { todayParis } = require('./_lib/dates');

const CRENEAUX_AUTORISES = ['8h-10h', '10h-12h'];

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
  const today = todayParis();
  if (newDate < today) {
    return res.status(400).json({ error: 'La date ne peut pas être dans le passé' });
  }

  const creneau = (body.creneau || '').trim();
  if (!CRENEAUX_AUTORISES.includes(creneau)) {
    return res.status(400).json({ error: 'Créneau invalide' });
  }

  try {
    const { data: prolongations } = await supabase
      .from('reservations').select('id').eq('reservation_origine_id', reservationId);
    const allResaIds = [reservationId, ...(prolongations || []).map(p => p.id)];

    const { data: liv, error: livErr } = await supabase
      .from('livraisons')
      .select('id, date_prevue, statut, transporteur_id')
      .in('reservation_id', allResaIds)
      .eq('type', 'recuperation')
      .not('statut', 'in', '(annulee,annule,refusee,fait)')
      .maybeSingle();
    if (livErr) throw livErr;
    if (!liv) return res.status(404).json({ error: 'Aucune récupération à venir trouvée' });

    if (liv.statut === 'en_route' || liv.statut === 'arrivee') {
      return res.status(409).json({ error: 'Un transporteur est déjà en route — la modification de créneau n\'est plus possible.' });
    }

    if (newDate >= liv.date_prevue) {
      return res.status(400).json({ error: 'La nouvelle date doit être antérieure à la date actuelle de récupération' });
    }

    // Met à jour date ET créneau — les espaces admin et transporteur lisent
    // directement ces colonnes via jointure, donc synchronisés automatiquement.
    const updateFields = { date_prevue: newDate, creneau };
    if (liv.statut === 'acceptee') updateFields.statut = 'a_faire';
    const { error: updateErr } = await supabase
      .from('livraisons')
      .update(updateFields)
      .eq('id', liv.id);
    if (updateErr) throw updateErr;

    const { data: resa } = await supabase
      .from('reservations')
      .select('tel, lang, prenom, ref')
      .eq('id', reservationId)
      .maybeSingle();

    // SMS de confirmation au client avec la nouvelle date et le nouveau créneau
    if (resa?.tel) {
      const lg = resa.lang || 'fr';
      const dateFmt = fmtDate(newDate, lg);
      let content;
      if (lg === 'en') {
        content = `Loc'Air - Your collection has been rescheduled to ${dateFmt}, time slot ${creneau}. Questions? Call us at +33 6 63 79 87 56.`;
      } else if (lg === 'zh') {
        content = `Loc'Air - 您的取回时间已更改为${dateFmt}，时间段：${creneau}。如有疑问，请致电 +33 6 63 79 87 56。`;
      } else if (lg === 'ru') {
        content = `Loc'Air - Возврат перенесён на ${dateFmt}, интервал ${creneau}. Вопросы? +33 6 63 79 87 56.`;
      } else {
        content = `Loc'Air - Votre récupération a été avancée au ${dateFmt}, créneau ${creneau}. Une question ? Appelez-nous au 06 63 79 87 56.`;
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
        message: `La récupération du dossier ${resa?.ref || ''} a été avancée au ${fmtDate(newDate, 'fr')}, créneau ${creneau}.`,
        livraisonId: liv.id,
        tag: `recup-avancee-${liv.id}`,
      }).catch(e => console.error('[client-recup notif transporteur]', e.message));
    }

    // Notification push à l'admin
    await pushToAdmin(supabase, {
      title: `📅 Récupération avancée — ${resa?.ref || 'dossier ' + reservationId}`,
      body: `${resa?.prenom || 'Un client'} a avancé sa récupération au ${fmtDate(newDate, 'fr')}, créneau ${creneau}.`,
      tag: `recup-avancee-${liv.id}`,
    });

    // Réinitialise l'idempotence : la nouvelle date doit déclencher le rappel
    // J-1 à nouveau sur la nouvelle date (sms_avis_google retiré de cette
    // liste le 2026-08-05 — ce SMS n'existe plus, voir cron-sms-avis.js).
    await supabase.from('email_log')
      .delete()
      .in('reservation_id', allResaIds)
      .in('scenario', ['sms_rappel_recuperation'])
      .then(() => {}, e => console.error('[client-recup reset SMS idempotence]', e.message));

    return res.status(200).json({ ok: true, date_prevue: newDate, creneau });
  } catch (e) {
    console.error('[client-recup]', e.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
