const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity, listCities } = require('./_lib/city');
const { getAvailability } = require('./_lib/stock');
const { checkAdminToken } = require('./_lib/auth');

function rangeStartISO(periode) {
  const d = new Date();
  if (periode === 'jour')      { d.setUTCHours(0, 0, 0, 0); }
  else if (periode === '30j')  { d.setUTCDate(d.getUTCDate() - 30); }
  else if (periode === 'mois') { d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); }
  else                         { d.setUTCDate(d.getUTCDate() - 7); } // '7j' par défaut
  return d.toISOString();
}

// Bornes [hier 00h, aujourd'hui 00h) — pour le résumé de performances de la
// veille affiché à la connexion.
function yesterdayRangeISO() {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0); start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
  return [start.toISOString(), end.toISOString()];
}

// Calcule les stats d'une seule ville — utilisé à la fois pour la vue
// "une ville" et pour chaque ligne de l'agrégat "toutes les villes".
async function computeCityStats(supabase, city, periode, since) {
  const { data: resas, error: resaErr } = await supabase
    .from('reservations')
    .select('prix_total_cents')
    .eq('city_id', city.id)
    .eq('statut', 'confirmee')
    .gte('created_at', since);
  if (resaErr) throw resaErr;

  const caCents = (resas || []).reduce((sum, r) => sum + (r.prix_total_cents || 0), 0);

  const { data: resasTotal, error: resaTotalErr } = await supabase
    .from('reservations')
    .select('prix_total_cents')
    .eq('city_id', city.id)
    .eq('statut', 'confirmee');
  if (resaTotalErr) throw resaTotalErr;
  const caTotalCents = (resasTotal || []).reduce((sum, r) => sum + (r.prix_total_cents || 0), 0);

  const { count: flotteTotale } = await supabase
    .from('appareils').select('id', { count: 'exact', head: true })
    .eq('city_id', city.id).not('statut', 'in', '(panne,maintenance)');

  const today    = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const disponibles = Math.max(0, await getAvailability(supabase, city.id, today, tomorrow));
  const occupees     = Math.max(0, (flotteTotale || 0) - disponibles);
  const tauxOccupation = flotteTotale > 0 ? occupees / flotteTotale : 0;

  const { count: incidentsOuverts } = await supabase
    .from('incidents').select('id', { count: 'exact', head: true }).eq('city_id', city.id).eq('statut', 'ouvert');
  const { count: incidentsPeriode } = await supabase
    .from('incidents').select('id', { count: 'exact', head: true }).eq('city_id', city.id).gte('created_at', since);

  const [hierStart, hierEnd] = yesterdayRangeISO();
  const { data: resasHier } = await supabase
    .from('reservations').select('prix_total_cents')
    .eq('city_id', city.id).eq('statut', 'confirmee')
    .gte('created_at', hierStart).lt('created_at', hierEnd);
  const caHierCents = (resasHier || []).reduce((sum, r) => sum + (r.prix_total_cents || 0), 0);

  const { data: cityResasIds } = await supabase.from('reservations').select('id').eq('city_id', city.id);
  const resaIds = (cityResasIds || []).map(r => r.id);
  let missionsTermineesHier = 0;
  if (resaIds.length) {
    const { count } = await supabase
      .from('livraisons').select('id', { count: 'exact', head: true })
      .in('reservation_id', resaIds).eq('statut', 'fait')
      .gte('fait_at', hierStart).lt('fait_at', hierEnd);
    missionsTermineesHier = count || 0;
  }
  const { count: incidentsHier } = await supabase
    .from('incidents').select('id', { count: 'exact', head: true })
    .eq('city_id', city.id).gte('created_at', hierStart).lt('created_at', hierEnd);

  return {
    periode,
    ville:              city.name,
    city_id:            city.id,
    ca_euros:           caCents / 100,
    ca_total_euros:     caTotalCents / 100,
    nb_reservations:    (resas || []).length,
    flotte_totale:      flotteTotale || 0,
    unites_occupees:    occupees,
    taux_occupation:    tauxOccupation,
    hier: {
      ca_euros:           caHierCents / 100,
      nb_reservations:    (resasHier || []).length,
      missions_terminees: missionsTermineesHier,
      incidents:          incidentsHier || 0,
    },
    incidents_ouverts:  incidentsOuverts || 0,
    incidents_periode:  incidentsPeriode || 0,
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body    = req.body || {};
  const periode = body.periode || '7j';
  const since   = rangeStartISO(periode);

  try {
    // Tableau de bord principal : agrège toutes les villes actives, avec le
    // détail par ville pour la ligne de tableau — le sélecteur envoie
    // city_id:'all' quand aucune ville précise n'est choisie.
    if (body.city_id === 'all') {
      const cities = await listCities(supabase);
      const parVille = [];
      for (const city of cities) {
        parVille.push(await computeCityStats(supabase, city, periode, since));
      }
      const sum = (key) => parVille.reduce((s, v) => s + (v[key] || 0), 0);
      const sumHier = (key) => parVille.reduce((s, v) => s + (v.hier[key] || 0), 0);
      return res.status(200).json({
        periode,
        agregat: true,
        ca_euros:          sum('ca_euros'),
        ca_total_euros:    sum('ca_total_euros'),
        nb_reservations:   sum('nb_reservations'),
        flotte_totale:     sum('flotte_totale'),
        unites_occupees:   sum('unites_occupees'),
        taux_occupation:   sum('flotte_totale') > 0 ? sum('unites_occupees') / sum('flotte_totale') : 0,
        hier: {
          ca_euros:           sumHier('ca_euros'),
          nb_reservations:    sumHier('nb_reservations'),
          missions_terminees: sumHier('missions_terminees'),
          incidents:          sumHier('incidents'),
        },
        incidents_ouverts: sum('incidents_ouverts'),
        incidents_periode: sum('incidents_periode'),
        par_ville: parVille,
      });
    }

    const city = await resolveAdminCity(supabase, body);
    if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });
    return res.status(200).json(await computeCityStats(supabase, city, periode, since));
  } catch (err) {
    console.error('[Admin dashboard]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
