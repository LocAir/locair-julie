const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { daysDiff, isSupersededReservation } = require('./_lib/emailSchedule');
const { sendRelanceProlongationSms } = require('./_lib/reservations');

function verifyCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = req.headers['authorization'] || '';
  const expected = `Bearer ${secret}`;
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// Cron du soir (18h30 heure de Paris) — le moment d'envoi compte plus que la
// précision à la minute pour ce SMS : le client le lit bien mieux en
// soirée qu'en pleine journée de travail. Relance prolongation, 4 jours
// avant la fin d'une location — déplacée ici depuis cron-daily.js (8h30) à
// la demande d'Aly, pour un envoi en soirée plutôt qu'en matinée.
//
// Le SMS "avis Google" (le soir même de la récupération) qui vivait ici a
// été retiré le 2026-08-05 (demande d'Aly, audit du parcours emails/SMS) :
// trop proche dans le temps du mail "fin_location" (envoyé dès la
// récupération validée), qui demande déjà un avis Google et offre en plus
// un code de parrainage — redondant de demander les deux la même heure.
// L'avis à l'installation (post_installation) reste, à un moment bien
// distinct du séjour.
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Non autorisé' });

  const supabase = getSupabase();

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

  return res.status(200).json({ ok: true, sentProlongation });
};
