const { getSupabase } = require('./_lib/supabase');
const { getClientIp, isRateLimited } = require('./_lib/ratelimit');

const BUCKET = 'portasplit-docs';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  try {
    if (await isRateLimited(getSupabase(), `upload-docs:${ip}`)) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
    }
  } catch { /* non bloquant */ }

  const { files } = req.body || {};
  // files = ['cni', 'justif'] par exemple
  if (!Array.isArray(files) || files.length === 0 || files.length > 3) {
    return res.status(400).json({ error: 'Paramètre files invalide.' });
  }

  const allowed = new Set(['cni', 'justif', 'autre']);
  for (const f of files) {
    if (!allowed.has(f)) return res.status(400).json({ error: `Type de fichier inconnu : ${f}` });
  }

  const supabase = getSupabase();
  const ts   = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const folder = `${ts}-${rand}`;

  try {
    const result = {};
    for (const type of files) {
      const path = `${folder}/${type}`;
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUploadUrl(path);

      if (error) throw error;
      result[type] = { signedUrl: data.signedUrl, path };
    }
    return res.status(200).json({ urls: result, folder });
  } catch (err) {
    console.error('[upload-docs-portasplit]', err.message);
    return res.status(500).json({ error: 'Erreur génération URL upload.' });
  }
};
