const https   = require('https');
const { getSupabase } = require('./_lib/supabase');

// Lien de consultation envoyé par email au client — jamais le chemin de
// stockage brut, toujours ce token opaque (voir _lib/documents.js). Marque le
// document "consulté" au premier accès, puis PROXY le contenu directement
// (plus de redirection 302 vers Supabase : les iframes bloquent les réponses
// cross-origin avec X-Frame-Options, ce qui donnait une icône "fichier cassé").
// ?dl=1 → Content-Disposition: attachment (téléchargement avec bon nom de fichier)
// sans ?dl  → Content-Disposition: inline  (affichage dans l'iframe ou le navigateur)
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = String(req.query?.token || '').trim();
  if (!token || token.length < 16) return res.status(400).send('Lien invalide.');

  try {
    const supabase = getSupabase();

    const { data: doc, error: docErr } = await supabase
      .from('documents').select('id, storage_path, statut, type, numero').eq('access_token', token).maybeSingle();
    if (docErr) {
      console.error('[dv] 1-DB-ERR', docErr.code, docErr.message);
      return res.status(500).send('Document temporairement indisponible. Contactez-nous : <a href="https://wa.me/33663798756">WhatsApp</a> ou <a href="mailto:contact@locair.fr">contact@locair.fr</a>');
    }
    if (!doc) { console.error('[dv] 1-NOT-FOUND token:', token.slice(0,8)); return res.status(404).send('Document introuvable ou lien expiré.'); }
    if (!doc.storage_path) { console.error('[dv] 1-NO-PATH id:', doc.id); return res.status(500).send('Document temporairement indisponible.'); }
    console.log('[dv] 2-SIGN path:', doc.storage_path);

    const { data: signed, error: signErr } = await supabase.storage.from('missions').createSignedUrl(doc.storage_path, 300);
    console.log('[dv] 3-SIGNED signErr:', signErr?.message ?? null, 'hasUrl:', !!signed?.signedUrl, 'url50:', signed?.signedUrl?.slice(0, 50) ?? null);
    if (signErr || !signed?.signedUrl) {
      console.error('[dv] 3-SIGN-ERR', signErr?.message, 'path:', doc.storage_path);
      return res.status(500).send('Document temporairement indisponible. Contactez-nous : <a href="https://wa.me/33663798756">WhatsApp</a> ou <a href="mailto:contact@locair.fr">contact@locair.fr</a>');
    }

    if (doc.statut !== 'consulte') {
      await supabase.from('documents').update({ statut: 'consulte', consulte_at: new Date().toISOString() }).eq('id', doc.id).then(() => {}, () => {});
    }

    // Proxy le PDF depuis notre serveur dans les deux modes :
    // - ?dl=1  → attachment (déclenche le téléchargement)
    // - défaut → inline (affiche dans l'iframe, sans X-Frame-Options Supabase)
    const fname = doc.numero
      ? `${doc.numero}.pdf`
      : (doc.type === 'contrat' ? 'contrat-location.pdf' : 'facture.pdf');
    const disposition = req.query.dl === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${fname}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // autorise l'iframe sur notre domaine
    console.log('[dv] 4-PROXY', disposition, fname);
    await new Promise((resolve) => {
      https.get(signed.signedUrl, (upstream) => {
        upstream.pipe(res);
        upstream.on('end', resolve);
        upstream.on('error', (e) => { console.error('[dv] PIPE-ERR', e.message); resolve(); });
      }).on('error', (e) => {
        console.error('[dv] GET-ERR', e.message);
        if (!res.headersSent) res.status(500).end('Erreur de chargement du document.');
        resolve();
      });
    });
  } catch (e) {
    console.error('[dv] CATCH', e.message, e.stack?.split('\n')[1]?.trim() ?? '');
    return res.status(500).send('Document temporairement indisponible. Contactez-nous : <a href="https://wa.me/33663798756">WhatsApp</a> ou <a href="mailto:contact@locair.fr">contact@locair.fr</a>');
  }
};
