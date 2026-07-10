const { getSupabase } = require('./_lib/supabase');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

// Retourne une URL Supabase Storage signée pour uploader la photo de fenêtre
// depuis le formulaire de réservation. Stockée dans le bucket "missions" déjà
// existant, sous le préfixe window-photos/. Aucun token client requis : l'URL
// signée n'est valable que 5 min et le path généré est non-devinable.
// Limite : 20 URLs signées par IP par 10 minutes pour empêcher le remplissage
// du bucket par un script d'attaque.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const ip = getClientIp(req);
  if (await isRateLimited(supabase, `upload:${ip}`, 20, 10)) {
    return res.status(429).json({ error: 'Trop de requêtes, veuillez réessayer dans quelques minutes' });
  }
  await recordFailedAttempt(supabase, `upload:${ip}`);

  const { content_type } = req.body || {};
  const ext = (content_type || '').includes('png') ? 'png' : 'jpg';
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now();
  const path = `window-photos/${ts}-${rand}.${ext}`;

  const { data, error } = await supabase.storage
    .from('missions')
    .createSignedUploadUrl(path, { upsert: false });

  if (error) {
    console.error('[checkout-window-photo]', error.message);
    return res.status(500).json({ error: 'Upload indisponible' });
  }

  return res.status(200).json({ ok: true, path: data.path, signedUrl: data.signedUrl });
};
