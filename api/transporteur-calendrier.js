const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');

// Vue calendrier du parc pour le transporteur — même principe que le
// calendrier admin (Réservations → Calendrier), pour qu'il voie d'un coup
// d'œil quel appareil est loué et quand, sans devoir ouvrir chaque mission.
// Scope strictement à la ville du transporteur (jamais fourni par le client,
// toujours résolu depuis son token) et ne renvoie que le strict nécessaire à
// l'affichage (prénom/nom/dates/statut/appareil) — jamais l'adresse, le
// téléphone ou les instructions d'accès des clients dont il n'a pas la
// mission, contrairement à admin-reservations.js qui a accès à tout.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const transporteurId = await verifyTransporteurToken(req, supabase);
  if (!transporteurId) return res.status(401).json({ error: 'Session invalide' });

  try {
    const { data: transporteur } = await supabase
      .from('transporteurs').select('city_id').eq('id', transporteurId).maybeSingle();
    if (!transporteur) return res.status(404).json({ error: 'Transporteur introuvable' });

    const today = new Date();
    const winStart = new Date(today); winStart.setMonth(winStart.getMonth() - 2);
    const winEnd   = new Date(today); winEnd.setMonth(winEnd.getMonth() + 4);
    const [{ data: appareilsRaw, error: appErr }, { data: resasRaw, error: resaErr }] = await Promise.all([
      supabase.from('appareils').select('numero, statut').eq('city_id', transporteur.city_id).order('numero'),
      supabase.from('reservations')
        .select('id, prenom, nom, statut, masquee, date_debut, date_fin, reservation_appareils ( appareil:appareils ( numero ) )')
        .eq('city_id', transporteur.city_id)
        .eq('masquee', false)
        .gte('date_fin', winStart.toISOString().slice(0, 10))
        .lte('date_debut', winEnd.toISOString().slice(0, 10)),
    ]);
    if (appErr) throw appErr;
    if (resaErr) throw resaErr;

    const reservations = (resasRaw || []).map(r => ({
      id:               r.id,
      prenom:           r.prenom,
      nom:              r.nom,
      statut:           r.statut,
      masquee:          r.masquee,
      date_debut:       r.date_debut,
      date_fin:         r.date_fin,
      appareil_numeros: (r.reservation_appareils || []).map(ra => ra.appareil?.numero).filter(Boolean),
    }));

    return res.status(200).json({ appareils: appareilsRaw || [], reservations });
  } catch (e) {
    console.error('[transporteur-calendrier]', e.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
