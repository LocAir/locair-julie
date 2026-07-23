const { getSupabase } = require('./_lib/supabase');

// Lien de consultation envoyé par email au client — jamais le chemin de
// stockage brut, toujours ce token opaque (voir _lib/documents.js). Marque le
// document "consulté" au premier accès, puis redirige vers une URL signée
// Supabase Storage de courte durée (5 min, comme les autres accès du dépôt).
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = String(req.query?.token || '').trim();
  if (!token) return res.status(400).send('Lien invalide.');

  const supabase = getSupabase();
  try {
    const { data: doc, error: docErr } = await supabase
      .from('documents').select('id, storage_path, statut').eq('access_token', token).maybeSingle();
    if (docErr) throw docErr;
    if (!doc) return res.status(404).send('Document introuvable ou lien expiré.');

    const { data: signed, error } = await supabase.storage.from('missions').createSignedUrl(doc.storage_path, 300);
    if (error || !signed) return res.status(500).send('Document temporairement indisponible.');

    if (doc.statut !== 'consulte') {
      await supabase.from('documents').update({ statut: 'consulte', consulte_at: new Date().toISOString() }).eq('id', doc.id).catch(() => {});
    }

    res.writeHead(302, { Location: signed.signedUrl });
    return res.end();
  } catch (e) {
    console.error('[document-view]', e.message);
    return res.status(500).send('Erreur serveur.');
  }
};
