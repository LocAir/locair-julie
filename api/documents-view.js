const { getSupabase } = require('./_lib/supabase');

function renderPage(errorMsg, buttons) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="font-family:Arial,sans-serif;color:#333;max-width:420px;margin:60px auto;padding:0 20px;text-align:center">
    <h2 style="color:#1b3a5f">Vos documents Loc'Air</h2>
    ${errorMsg ? `<p style="color:#c0392b">${errorMsg}</p>` : `
    <p style="color:#666">Choisissez le document à consulter :</p>
    <div style="display:flex;flex-direction:column;gap:12px;margin-top:24px">
      ${buttons.map(b => `<a href="${b.href}" style="display:block;background:#1b3a5f;color:#fff;padding:14px;border-radius:8px;text-decoration:none;font-weight:600">${b.label}</a>`).join('')}
    </div>`}
  </body></html>`;
}

// Page de consultation unique envoyée par email (voir _lib/documents.js) —
// regroupe l'accès au contrat ET à la facture d'un même dossier derrière un
// seul lien, plutôt que d'envoyer deux liens séparés au client. Chaque
// bouton renvoie ensuite vers /api/document-view?token=..., qui gère seul
// la validation du token, le marquage "consulté" et la redirection vers le
// PDF signé — cette page ne fait que les lister, jamais leur logique.
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');

  const contratToken = String(req.query?.contrat || '').trim();
  const factureToken = String(req.query?.facture || '').trim();
  const tokens = [contratToken, factureToken].filter(Boolean);
  if (!tokens.length) return res.status(400).send(renderPage('Lien invalide.', []));

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  try {
    const supabase = getSupabase();
    const { data: docs } = await supabase.from('documents').select('access_token').in('access_token', tokens);
    const validTokens = new Set((docs || []).map(d => d.access_token));

    const buttons = [];
    if (contratToken && validTokens.has(contratToken)) {
      buttons.push({ label: '📄 Consulter le contrat', href: `/api/document-view?token=${contratToken}` });
    }
    if (factureToken && validTokens.has(factureToken)) {
      buttons.push({ label: '🧾 Consulter la facture', href: `/api/document-view?token=${factureToken}` });
    }

    if (!buttons.length) return res.status(404).send(renderPage('Documents introuvables ou lien expiré.', []));
    return res.status(200).send(renderPage(null, buttons));
  } catch (e) {
    console.error('[documents-view]', e.message);
    return res.status(500).send(renderPage('Erreur serveur.', []));
  }
};
