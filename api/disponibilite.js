// Calendrier de disponibilité sur 90 jours — utilisé par le site pour afficher
// quelles dates sont complètes et suggérer la prochaine date disponible.
// Prend en compte la date de récupération réelle (mission livraisons.date_prevue)
// plutôt que la date_fin brute : un appareil récupéré le 11 août n'est disponible
// qu'à partir du 12 août (J+1 après récupération), pas du 11.
// Cache HTTP public 120 s — rafraîchi au maximum toutes les 2 minutes côté client.
const { getSupabase } = require('./_lib/supabase');
const { getCity }     = require('./_lib/city');
const { todayParis, addDays, dateInParis } = require('./_lib/dates');

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
    // 'loue' N'EST PAS exclu ici, volontairement : un appareil actuellement
    // en location redevient disponible à une date connue (la récupération,
    // gérée plus bas via les blocs date_debut/récupération) — l'exclure du
    // total le ferait disparaître du calcul pour tout le calendrier des 90
    // jours, y compris pour les dates APRÈS sa récupération (bug trouvé le
    // 2026-08-09 : "j'ai des récupérations demain donc des appareils
    // disponibles, et pourtant le calendrier affiche complet"). Seuls les
    // statuts sans date de retour connue (panne, maintenance, nettoyage en
    // attente, vendu) sont exclus du total.
    const { count: totalCount } = await supabase
      .from('appareils')
      .select('id', { count: 'exact', head: true })
      .eq('city_id', city.id)
      .not('statut', 'in', '("panne","maintenance","nettoyage","vendu")');
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
    // Priorité à la vraie date de complétion (statut 'fait', date réelle
    // fait_at) sur la date simplement prévue (date_prevue) — un climatiseur
    // récupéré aujourd'hui doit être disponible dès demain, même si la
    // récupération a eu lieu plus tôt ou plus tard que prévu au départ.
    // Une tentative ratée ('probleme') n'est jamais retenue comme date
    // fiable : le climatiseur n'est objectivement pas revenu ce jour-là,
    // et une date_prevue déjà dépassée sans succès ne veut plus rien dire.
    let recupByResaId = {};
    if (resaIds.length > 0) {
      const { data: recups } = await supabase
        .from('livraisons')
        .select('reservation_id, date_prevue, statut, fait_at')
        .in('reservation_id', resaIds)
        .eq('type', 'recuperation')
        .not('statut', 'in', '("annule","refusee")');

      const faitByResa = {};
      const prevueByResa = {};
      for (const m of (recups || [])) {
        const resaId = m.reservation_id;
        if (m.statut === 'fait' && m.fait_at) {
          const d = dateInParis(m.fait_at);
          if (!faitByResa[resaId] || d > faitByResa[resaId]) faitByResa[resaId] = d;
        } else if (m.statut !== 'probleme') {
          const d = m.date_prevue.slice(0, 10);
          if (!prevueByResa[resaId] || d > prevueByResa[resaId]) prevueByResa[resaId] = d;
        }
      }
      for (const resaId of new Set([...Object.keys(faitByResa), ...Object.keys(prevueByResa)])) {
        recupByResaId[resaId] = faitByResa[resaId] || prevueByResa[resaId];
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
