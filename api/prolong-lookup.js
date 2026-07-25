const { getSupabase } = require('./_lib/supabase');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, ref } = req.body || {};
  if (!email || !ref) return res.status(400).json({ error: 'Email et référence de commande requis' });

  const supabase = getSupabase();

  const ip = getClientIp(req);
  if (await isRateLimited(supabase, `prolong:${ip}`)) return res.status(429).json({ error: 'Trop de tentatives, réessayez dans 15 minutes.' });

  const normalizedEmail = String(email).trim().toLowerCase();
  // .eq('statut','confirmee') indispensable : sans lui, une réservation plus
  // récente mais annulée/en attente sous le même email (tentative abandonnée,
  // doublon) pouvait remonter à la place de la vraie réservation active — la
  // prolongation se rattachait alors à la mauvaise réservation. Même filtre
  // déjà en place côté admin (admin-reservations.js, action
  // 'lookup_prolongation').
  const { data: resa, error } = await supabase
    .from('reservations')
    .select('ref, prenom, date_debut, date_fin, quantite, statut')
    .ilike('email', normalizedEmail)
    .eq('ref', ref.trim().toUpperCase())
    .not('source', 'eq', 'site_prolongation')
    .eq('statut', 'confirmee')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[prolong-lookup]', error.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }

  if (!resa) {
    await recordFailedAttempt(supabase, `prolong:${ip}`).catch(() => {});
    return res.status(404).json({ error: 'Aucune location trouvée — vérifiez votre email et référence de commande.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  if (resa.date_fin < today) {
    await recordFailedAttempt(supabase, `prolong:${ip}`).catch(() => {});
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
