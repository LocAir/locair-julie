const { getSupabase } = require('./_lib/supabase');
const { getCity }     = require('./_lib/city');
const { getAvailability } = require('./_lib/stock');
const { isValidDate } = require('./_lib/dates');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const data       = req.body || {};
  const quantite   = Math.min(5, Math.max(1, parseInt(data.quantite) || 1));
  const dateDebut  = (data.date_debut || '').slice(0, 10);
  const dateFin    = (data.date_fin   || '').slice(0, 10);

  if (!isValidDate(dateDebut) || !isValidDate(dateFin) || dateFin <= dateDebut) {
    return res.status(400).json({ error: 'Dates invalides' });
  }

  try {
    const supabase    = getSupabase();
    const city        = await getCity(supabase);
    const disponibles = Math.max(0, await getAvailability(supabase, city.id, dateDebut, dateFin));
    return res.status(200).json({ available: disponibles >= quantite, disponibles });
  } catch (err) {
    console.error('[Stock check]', err.message);
    return res.status(500).json({ error: 'Erreur serveur stock' });
  }
};
