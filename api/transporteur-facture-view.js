const https   = require('https');
const { getSupabase } = require('./_lib/supabase');

// Téléchargement/consultation d'une facture transporteur, par lien à token
// opaque — même principe que document-view.js (contrat/facture client), sur
// la table transporteur_factures. Public (pas d'auth admin/transporteur
// requise) mais protégé par le token, comme le reste des liens de documents
// de l'app : partagé aussi bien depuis l'espace transporteur que depuis
// l'admin (un seul endpoint de téléchargement pour les deux côtés).
// ?dl=1 → Content-Disposition: attachment (téléchargement)
// sans ?dl  → Content-Disposition: inline (affichage direct)
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = String(req.query?.token || '').trim();
  if (!token || token.length < 16) return res.status(400).send('Lien invalide.');

  try {
    const supabase = getSupabase();

    const { data: fac, error: facErr } = await supabase
      .from('transporteur_factures').select('id, numero, storage_path').eq('access_token', token).maybeSingle();
    if (facErr) {
      console.error('[tfv] DB-ERR', facErr.code, facErr.message);
      return res.status(500).send('Document temporairement indisponible. Contactez-nous : contact@locair.fr');
    }
    if (!fac) return res.status(404).send('Document introuvable ou lien expiré.');
    if (!fac.storage_path) return res.status(500).send('Document temporairement indisponible.');

    const { data: signed, error: signErr } = await supabase.storage.from('missions').createSignedUrl(fac.storage_path, 300);
    if (signErr || !signed?.signedUrl) {
      console.error('[tfv] SIGN-ERR', signErr?.message, 'path:', fac.storage_path);
      return res.status(500).send('Document temporairement indisponible. Contactez-nous : contact@locair.fr');
    }

    const fname = fac.numero ? `${fac.numero}.pdf` : 'facture.pdf';
    const disposition = req.query.dl === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${fname}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    await new Promise((resolve) => {
      https.get(signed.signedUrl, (upstream) => {
        upstream.pipe(res);
        upstream.on('end', resolve);
        upstream.on('error', (e) => { console.error('[tfv] PIPE-ERR', e.message); resolve(); });
      }).on('error', (e) => {
        console.error('[tfv] GET-ERR', e.message);
        if (!res.headersSent) res.status(500).end('Erreur de chargement du document.');
        resolve();
      });
    });
  } catch (e) {
    console.error('[tfv] CATCH', e.message, e.stack?.split('\n')[1]?.trim() ?? '');
    return res.status(500).send('Document temporairement indisponible. Contactez-nous : contact@locair.fr');
  }
};
