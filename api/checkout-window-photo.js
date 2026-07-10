const { getSupabase } = require('./_lib/supabase');

// Retourne une URL Supabase Storage signée pour uploader la photo de fenêtre
// depuis le formulaire de réservation. Stockée dans le bucket "missions" déjà
// existant, sous le préfixe window-photos/. Aucun token client requis : l'URL
// signée n'est valable que 5 min et le path généré est non-devinable.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { content_type } = req.body || {};
  const ext = (content_type || '').includes('png') ? 'png' : 'jpg';
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now();
  const path = `window-photos/${ts}-${rand}.${ext}`;

  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from('missions')
    .createSignedUploadUrl(path, { upsert: false });

  if (error) {
    console.error('[checkout-window-photo]', error.message);
    return res.status(500).json({ error: 'Upload indisponible' });
  }

  return res.status(200).json({ ok: true, path: data.path, signedUrl: data.signedUrl });
};
