const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const transporteurId = await verifyTransporteurToken(req, supabase);
  if (!transporteurId) return res.status(401).json({ error: 'Session invalide' });

  try {
    const { data: appareils, error } = await supabase
      .from('appareils')
      .select('id, numero, statut, reference')
      .order('numero');
    if (error) throw error;

    const list        = appareils || [];
    const total       = list.length;
    const disponibles = list.filter(a => a.statut === 'disponible').length;
    const en_panne    = list.filter(a => a.statut === 'panne').length;
    const maintenance = list.filter(a => a.statut === 'maintenance').length;
    // Seuil d'alerte : 10 % du stock total (minimum 1)
    const seuil_alerte = Math.max(1, Math.round(total * 0.1));

    const today = new Date().toISOString().slice(0, 10);
    const { data: liens } = await supabase
      .from('reservation_appareils')
      .select('appareil_id, reservation:reservations(statut, date_debut, date_fin)');
    const enLocationIds = new Set(
      (liens || [])
        .filter(l => l.reservation?.statut === 'confirmee'
          && l.reservation.date_debut <= today && l.reservation.date_fin > today)
        .map(l => l.appareil_id),
    );
    const en_location = enLocationIds.size;

    return res.status(200).json({
      total, disponibles, en_location, en_panne, maintenance, seuil_alerte,
      appareils: list.map(a => ({ ...a, en_location: enLocationIds.has(a.id) })),
    });
  } catch (err) {
    console.error('[Transporteur stock]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
