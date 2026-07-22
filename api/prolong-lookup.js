const { getSupabase } = require('./_lib/supabase');
const { getClientIp, isRateLimited } = require('./_lib/ratelimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, ref } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email requis' });

  const supabase = getSupabase();

  const ip = getClientIp(req);
  if (await isRateLimited(supabase, `prolong:${ip}`)) return res.status(429).json({ error: 'Trop de tentatives, réessayez dans 15 minutes.' });

  let q = supabase
    .from('reservations')
    .select('ref, prenom, date_debut, date_fin, quantite, statut')
    .ilike('email', String(email).trim())
    .not('source', 'eq', 'site_prolongation')
    .order('created_at', { ascending: false })
    .limit(1);

  if (ref && ref.trim()) {
    q = supabase
      .from('reservations')
      .select('ref, prenom, date_debut, date_fin, quantite, statut')
      .ilike('email', String(email).trim())
      .ilike('ref', ref.trim().toUpperCase())
      .not('source', 'eq', 'site_prolongation')
      .order('created_at', { ascending: false })
      .limit(1);
  }

  const { data: resa, error } = await q.maybeSingle();

  if (error) {
    console.error('[prolong-lookup]', error.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }

  if (!resa) {
    return res.status(404).json({ error: 'Aucune location trouvée — vérifiez votre email et référence de commande.' });
  }

  if (['annulee', 'remboursee'].includes(resa.statut)) {
    return res.status(422).json({ error: 'Cette location ne peut pas être prolongée.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  if (resa.date_fin < today) {
    return res.status(422).json({ error: 'Votre location est déjà terminée — impossible de la prolonger.' });
  }

  const origDays = Math.round(
    (new Date(resa.date_fin + 'T00:00:00Z') - new Date(resa.date_debut + 'T00:00:00Z')) / 86400000
  );

  return res.status(200).json({
    ref:        resa.ref,
    prenom:     resa.prenom || '',
    date_debut: resa.date_debut,
    date_fin:   resa.date_fin,
    quantite:   resa.quantite || 1,
    orig_days:  origDays,
  });
};
