// Pièce d'identité du client Click & Collect (carte d'identité recto/verso
// ou passeport) — retourne des URL d'envoi signées vers le bucket PRIVÉ
// « missions », sous identites/<dossier>/. Même mécanique que la photo de
// fenêtre (checkout-window-photo.js) : URL valable quelques minutes, chemin
// impossible à deviner, jamais de lien public. Les chemins sont ensuite
// rattachés à la réservation par checkout-click-collect.js, lus par l'admin
// (admin-reservations.js, action identite_urls) et supprimés 30 jours après
// la fin de la location (cron-daily.js).
const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');

const TYPES = { cni: ['recto', 'verso'], passeport: ['passeport'] };
const FORMATS = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const ip = getClientIp(req);
  try {
    if (await isRateLimited(supabase, `identite:${ip}`, 12, 10)) return res.status(429).json({ error: 'Trop d’envois, réessayez dans quelques minutes.' });
    await recordFailedAttempt(supabase, `identite:${ip}`);
  } catch (_e) { /* non bloquant */ }

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const faces = TYPES[b.type];
  if (!faces) return res.status(400).json({ error: 'Type de pièce inconnu.' });
  const formats = Array.isArray(b.formats) ? b.formats : [];
  if (formats.length !== faces.length || !formats.every((f) => FORMATS[f])) {
    return res.status(400).json({ error: 'Format non accepté (photo JPG, PNG, HEIC ou PDF).' });
  }

  const dossier = `identites/${Date.now()}-${crypto.randomBytes(9).toString('hex')}`;
  try {
    const urls = [];
    for (let i = 0; i < faces.length; i++) {
      const path = `${dossier}/${faces[i]}.${FORMATS[formats[i]]}`;
      const { data, error } = await supabase.storage.from('missions').createSignedUploadUrl(path, { upsert: false });
      if (error) throw error;
      urls.push({ face: faces[i], path: data.path, signedUrl: data.signedUrl });
    }
    return res.status(200).json({ ok: true, urls });
  } catch (e) {
    console.error('[upload-identite]', e.message);
    return res.status(500).json({ error: 'Envoi indisponible pour le moment.' });
  }
};
