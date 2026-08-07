// Calendrier de disponibilité sur 90 jours — utilisé par le site pour afficher
// quelles dates sont complètes et suggérer la prochaine date disponible.
// Prend en compte la date de récupération réelle (mission livraisons.date_prevue)
// plutôt que la date_fin brute : un appareil récupéré le 11 août n'est disponible
// qu'à partir du 12 août (J+1 après récupération), pas du 11.
// Cache HTTP public 120 s — rafraîchi au maximum toutes les 2 minutes côté client.
const { getSupabase } = require('./_lib/supabase');
const { getCity }     = require('./_lib/city');
const { todayParis, addDays } = require('./_lib/dates');

const HORIZON = 90; // jours

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=60');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabase = getSupabase();
    const city     = await getCity(supabase);
    const today    = todayParis();          // "YYYY-MM-DD"
    const endDate  = addDays(today, HORIZON);

    // ── 1. Total appareils opérationnels ───────────────────────────────────
    const { count: totalCount } = await supabase
      .from('appareils')
      .select('id', { count: 'exact', head: true })
      .eq('city_id', city.id)
      .not('statut', 'in', '("panne","maintenance","loue","nettoyage","vendu")');
    const total = totalCount || 0;

    // ── 2. Réservations confirmées actives ou à venir ──────────────────────
    // On prend une marge de 2 jours avant today pour capturer les récupérations
    // en cours (date_fin < today mais mission récup aujourd'hui ou demain).
    const { data: reservations } = await supabase
      .from('reservations')
      .select('id, date_debut, date_fin')
      .eq('city_id', city.id)
      .eq('statut', 'confirmee')
      .gte('date_fin', addDays(today, -2))
      .lte('date_debut', endDate);

    const resaIds = (reservations || []).map(r => r.id);

    // ── 3. Missions de récupération actives pour ces réservations ──────────
    // "annule" et "refusee" exclus — comme dans available_units.
    let recupByResaId = {};
    if (resaIds.length > 0) {
      const { data: recups } = await supabase
        .from('livraisons')
        .select('reservation_id, date_prevue')
        .in('reservation_id', resaIds)
        .eq('type', 'recuperation')
        .not('statut', 'in', '("annule","refusee")');

      for (const m of (recups || [])) {
        // Si plusieurs missions (prolongation annulée puis recréée), prendre la plus tardive
        if (!recupByResaId[m.reservation_id] || m.date_prevue > recupByResaId[m.reservation_id]) {
          recupByResaId[m.reservation_id] = m.date_prevue.slice(0, 10);
        }
      }
    }

    // ── 4. Nombre d'appareils par réservation ─────────────────────────────
    let unitsPerResa = {};
    if (resaIds.length > 0) {
      const { data: ras } = await supabase
        .from('reservation_appareils')
        .select('reservation_id')
        .in('reservation_id', resaIds);
      for (const ra of (ras || [])) {
        unitsPerResa[ra.reservation_id] = (unitsPerResa[ra.reservation_id] || 0) + 1;
      }
    }

    // ── 5. Période d'occupation de chaque appareil ────────────────────────
    // Occupé du date_debut AU JOUR DE RÉCUPÉRATION inclus.
    // Disponible à compter du lendemain de la récupération.
    const blocks = (reservations || []).map(r => {
      // date_fin par défaut → récupération J+1 = date_fin + 1 → dispo J+2
      const recupDate = recupByResaId[r.id] || addDays(r.date_fin, 1);
      const units = unitsPerResa[r.id] || 1;
      return { start: r.date_debut, end: recupDate, units };
    });

    // ── 6. Disponibilité jour par jour ────────────────────────────────────
    const dates = {};
    let nextAvailable = null;

    for (let i = 0; i < HORIZON; i++) {
      const d = addDays(today, i);
      let blocked = 0;
      for (const b of blocks) {
        if (d >= b.start && d <= b.end) blocked += b.units;
      }
      const available = Math.max(0, total - blocked);
      dates[d] = available;
      if (available > 0 && !nextAvailable) nextAvailable = d;
    }

    return res.status(200).json({
      total,
      dates,
      next_available: nextAvailable,
      today,
    });
  } catch (err) {
    console.error('[disponibilite]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
