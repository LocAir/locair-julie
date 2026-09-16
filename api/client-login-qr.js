const { getSupabase } = require('./_lib/supabase');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');
const { signClientToken } = require('./_lib/auth');

// Accès espace client depuis le QR collé sur le climatiseur (demande
// d'Aly, 2026-09-16) : le client scanne, retape juste son email (le
// numéro de commande n'est plus nécessaire — l'appareil scanné identifie
// déjà quelle réservation regarder), et arrive directement dans son
// espace prêt à prolonger. Le jeton QR (appareils.qr_token) identifie
// L'APPAREIL, pas le client — un même appareil sert des dizaines de
// locations différentes au fil du temps, donc on retrouve ici la
// réservation ACTIVE en ce moment pour cet appareil précis, jamais une
// réservation passée. Message d'erreur générique dans tous les cas
// d'échec, comme client-login.js, pour ne jamais laisser deviner quoi
// que ce soit sur qui loue quoi.
const GENERIC_ERROR = "Nous n'avons pas retrouvé de location active pour cet appareil avec cette adresse email.";

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();

  const ip = getClientIp(req);
  const rateKey = `client:${ip}`;
  if (await isRateLimited(supabase, rateKey)) {
    return res.status(429).json({ error: 'Trop de tentatives — réessayez dans quelques minutes.' });
  }

  const qrToken = String((req.body || {}).qr_token || '').trim();
  const email   = String((req.body || {}).email || '').trim().toLowerCase();
  if (!qrToken || !email) {
    await recordFailedAttempt(supabase, rateKey);
    return res.status(400).json({ error: GENERIC_ERROR });
  }

  try {
    const { data: appareil, error: appErr } = await supabase
      .from('appareils').select('id').eq('qr_token', qrToken).maybeSingle();
    if (appErr) throw appErr;
    if (!appareil) {
      await recordFailedAttempt(supabase, rateKey);
      return res.status(404).json({ error: GENERIC_ERROR });
    }

    // La réservation ACTIVE pour cet appareil précis — 'confirmee' exclut
    // déjà 'en_attente' (jamais payée), 'annulee', 'remboursee', 'terminee'
    // (rendu). S'il y en avait plusieurs (ne devrait jamais arriver, un
    // appareil ne sert qu'un client à la fois), la plus récente gagne —
    // c'est forcément celle qui a la main sur l'appareil en ce moment.
    const { data: liaisons, error: liaisonErr } = await supabase
      .from('reservation_appareils')
      .select('reservation:reservations(id, ref, email, reservation_origine_id, statut, created_at)')
      .eq('appareil_id', appareil.id);
    if (liaisonErr) throw liaisonErr;
    const actives = (liaisons || [])
      .map(l => l.reservation).filter(r => r && r.statut === 'confirmee')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const resa = actives[0];

    if (!resa) {
      await recordFailedAttempt(supabase, rateKey);
      return res.status(404).json({ error: GENERIC_ERROR });
    }

    // Même repli qu'à la connexion normale (client-login.js) : une
    // prolongation vit dans sa propre ligne reservations, sans appareil ni
    // livraison qui lui soit directement rattachée pour ce genre de calcul
    // — remonte toujours vers la réservation d'origine, qui porte l'espace
    // client complet.
    let target = resa;
    if (resa.reservation_origine_id) {
      const { data: origine } = await supabase
        .from('reservations').select('id, ref, email')
        .eq('id', resa.reservation_origine_id).maybeSingle();
      if (origine) target = origine;
    }

    if (!target.email || target.email.toLowerCase() !== email) {
      await recordFailedAttempt(supabase, rateKey);
      return res.status(404).json({ error: GENERIC_ERROR });
    }

    const token = signClientToken(target.id, target.ref);
    return res.status(200).json({ ok: true, token, ref: target.ref });
  } catch (err) {
    console.error('[client-login-qr]', err.message);
    return res.status(500).json({ error: GENERIC_ERROR });
  }
};
