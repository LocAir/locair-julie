const { getSupabase } = require('./_lib/supabase');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');
const { verifyClientToken } = require('./_lib/auth');
const { getEffectiveDateFin } = require('./_lib/reservations');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, ref, token } = req.body || {};

  const supabase = getSupabase();

  const ip = getClientIp(req);
  if (await isRateLimited(supabase, `prolong:${ip}`)) return res.status(429).json({ error: 'Trop de tentatives, réessayez dans 15 minutes.' });

  let resa, error;

  if (token) {
    // Client déjà connecté à son espace client (client/index.html, jeton
    // signClientToken) : il a déjà prouvé qui il est, pas la peine de lui
    // redemander email + numéro de commande une 2e fois pour prolonger —
    // le jeton identifie sans ambiguïté sa réservation (demande du
    // propriétaire du 2026-07-28 : supprimer cette redondance).
    const reservationId = await verifyClientToken(req, supabase);
    if (!reservationId) return res.status(401).json({ error: 'Session expirée — reconnectez-vous à votre espace client.' });
    ({ data: resa, error } = await supabase
      .from('reservations')
      .select('id, ref, prenom, email, date_debut, date_fin, quantite, statut')
      .eq('id', reservationId)
      .not('source', 'eq', 'site_prolongation')
      .eq('statut', 'confirmee')
      .maybeSingle());
  } else {
    if (!email || !ref) return res.status(400).json({ error: 'Email et référence de commande requis' });
    const normalizedEmail = String(email).trim().toLowerCase();
    // .eq('statut','confirmee') indispensable : sans lui, une réservation plus
    // récente mais annulée/en attente sous le même email (tentative abandonnée,
    // doublon) pouvait remonter à la place de la vraie réservation active — la
    // prolongation se rattachait alors à la mauvaise réservation. Même filtre
    // déjà en place côté admin (admin-reservations.js, action
    // 'lookup_prolongation').
    ({ data: resa, error } = await supabase
      .from('reservations')
      .select('id, ref, prenom, email, date_debut, date_fin, quantite, statut')
      .ilike('email', normalizedEmail)
      .eq('ref', ref.trim().toUpperCase())
      .not('source', 'eq', 'site_prolongation')
      .eq('statut', 'confirmee')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle());
  }

  if (error) {
    console.error('[prolong-lookup]', error.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }

  if (!resa) {
    if (!token) await recordFailedAttempt(supabase, `prolong:${ip}`).catch(() => {});
    return res.status(404).json({ error: 'Aucune location trouvée — vérifiez votre email et référence de commande.' });
  }

  // Si le client a déjà prolongé au moins une fois et que la mise à jour de
  // date_fin sur l'origine a silencieusement raté (même filet que
  // checkout-prolong.js/prolong-pay.js, voir getEffectiveDateFin), une
  // nouvelle prolongation serait ici refusée à tort ("déjà terminée") alors
  // qu'une prolongation confirmée existe bel et bien derrière.
  resa.date_fin = await getEffectiveDateFin(supabase, resa.id, resa.date_fin);

  const today = new Date().toISOString().slice(0, 10);
  if (resa.date_fin < today) {
    if (!token) await recordFailedAttempt(supabase, `prolong:${ip}`).catch(() => {});
    return res.status(422).json({ error: 'Votre location est déjà terminée — impossible de la prolonger.' });
  }

  const origDays = Math.round(
    (new Date(resa.date_fin + 'T00:00:00Z') - new Date(resa.date_debut + 'T00:00:00Z')) / 86400000
  );

  return res.status(200).json({
    ref:        resa.ref,
    prenom:     resa.prenom || '',
    // Renvoyé uniquement pour l'auto-connexion par jeton (le formulaire
    // manuel connaît déjà l'email qu'il a lui-même saisi) — nécessaire pour
    // l'appel /api/prolong-pay qui suit, qui identifie toujours la
    // réservation par email + référence, jamais par jeton.
    email:      resa.email || '',
    date_debut: resa.date_debut,
    date_fin:   resa.date_fin,
    quantite:   resa.quantite || 1,
    orig_days:  origDays,
  });
};
