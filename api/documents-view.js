const { getSupabase } = require('./_lib/supabase');

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const NAV = '#1b3a5f';
const GOLD = '#c5a96c';

function renderPage(errorMsg, { ref, buttons } = {}) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Vos documents Loc'Air</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#eee8dd;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px}
    .card{background:#fff;border-radius:20px;box-shadow:0 8px 40px rgba(13,29,51,.12);width:100%;max-width:460px;overflow:hidden}
    .head{background:${NAV};padding:36px 32px 28px;text-align:center}
    .brand{font-size:11px;font-weight:700;letter-spacing:.14em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:18px}
    .head-ico{width:50px;height:50px;background:rgba(197,169,108,.18);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:22px}
    .head h1{color:#fff;font-size:20px;font-weight:700;line-height:1.3;margin-bottom:${ref ? '8px' : '0'}}
    .head-ref{color:rgba(255,255,255,.5);font-size:13px;font-weight:500;letter-spacing:.01em}
    .body{padding:28px 28px 32px}
    .thanks{font-size:14px;color:#4a5568;line-height:1.65;margin-bottom:22px;padding-bottom:20px;border-bottom:1.5px solid #f0ece4}
    .thanks strong{color:${NAV}}
    .section-lbl{font-size:10.5px;font-weight:700;letter-spacing:.1em;color:#9aa0ab;text-transform:uppercase;margin-bottom:11px}
    .doc-btn{display:flex;align-items:center;gap:14px;border:1.5px solid #e8e0d0;border-radius:12px;padding:15px 16px;text-decoration:none;color:${NAV};margin-bottom:9px;transition:border-color .2s,background .2s,transform .15s}
    .doc-btn:last-of-type{margin-bottom:0}
    .doc-btn:hover{background:#f7f5f0;border-color:${GOLD};transform:translateY(-1px)}
    .doc-ico{width:42px;height:42px;background:${NAV};border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
    .doc-info{flex:1}
    .doc-name{font-weight:700;font-size:14.5px;color:${NAV};display:block;margin-bottom:2px}
    .doc-desc{font-size:12px;color:#9aa0ab}
    .doc-arrow{color:${GOLD};font-size:16px;font-weight:700;flex-shrink:0}
    .help{margin-top:22px;padding-top:18px;border-top:1.5px solid #f0ece4;font-size:13px;color:#9aa0ab;text-align:center;line-height:1.6}
    .help a{color:${NAV};font-weight:600;text-decoration:none}
    .error-wrap{text-align:center;padding:12px 0}
    .error-ico{font-size:34px;margin-bottom:12px}
    .error-msg{color:#c0392b;font-weight:600;font-size:15px;margin-bottom:6px}
    .error-sub{color:#9aa0ab;font-size:13px}
  </style>
</head>
<body>
<div class="card">
  <div class="head">
    <div class="brand">Loc'Air</div>
    <div class="head-ico">📄</div>
    <h1>Vos documents</h1>
    ${ref ? `<div class="head-ref">Dossier ${escHtml(ref)}</div>` : ''}
  </div>
  <div class="body">
    ${errorMsg ? `
    <div class="error-wrap">
      <div class="error-ico">⚠️</div>
      <div class="error-msg">${errorMsg}</div>
      <div class="error-sub">Contactez-nous si le problème persiste : <a href="https://wa.me/33663798756" style="color:${NAV};font-weight:600">WhatsApp</a> · <a href="mailto:contact@locair.fr" style="color:${NAV};font-weight:600">contact@locair.fr</a></div>
    </div>` : `
    <p class="thanks">Merci pour votre confiance. Vos documents sont disponibles à tout moment au format PDF.</p>
    <div class="section-lbl">Consulter un document</div>
    ${buttons.map(b => `
    <a href="${b.href}" class="doc-btn">
      <div class="doc-ico">${b.icon}</div>
      <div class="doc-info">
        <span class="doc-name">${b.label}</span>
        <span class="doc-desc">${b.desc}</span>
      </div>
      <span class="doc-arrow">›</span>
    </a>`).join('')}
    <div class="help">Une question ?&nbsp; <a href="https://wa.me/33663798756">WhatsApp</a>&nbsp;·&nbsp;<a href="mailto:contact@locair.fr">contact@locair.fr</a></div>`}
  </div>
</div>
</body>
</html>`;
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
  const avenantToken = String(req.query?.avenant || '').trim();
  const factureToken = String(req.query?.facture || '').trim();
  const tokens = [contratToken, avenantToken, factureToken].filter(Boolean);
  if (!tokens.length) return res.status(400).send(renderPage('Lien invalide.'));

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  try {
    const supabase = getSupabase(); // peut lever si variables d'env manquantes
    const { data: docs, error: docsErr } = await supabase
      .from('documents')
      .select('access_token, reservation:reservations(ref)')
      .in('access_token', tokens);
    if (docsErr) {
      console.error('[documents-view] DB error:', docsErr.message, docsErr.code);
      return res.status(500).send(renderPage('Documents temporairement indisponibles. Contactez-nous sur WhatsApp ou par email si le problème persiste.'));
    }
    const validTokens = new Set((docs || []).map(d => d.access_token));
    const ref = (docs || []).find(d => d.reservation?.ref)?.reservation?.ref || null;

    const buttons = [];
    if (contratToken && validTokens.has(contratToken)) {
      buttons.push({
        icon: '📄', label: 'Contrat de location',
        desc: 'Conditions, durée et modalités de votre location',
        href: `/api/document-view?token=${contratToken}`,
      });
    }
    if (avenantToken && validTokens.has(avenantToken)) {
      buttons.push({
        icon: '📝', label: 'Avenant de prolongation',
        desc: 'Modification de la durée de votre contrat',
        href: `/api/document-view?token=${avenantToken}`,
      });
    }
    if (factureToken && validTokens.has(factureToken)) {
      buttons.push({
        icon: '🧾', label: 'Facture',
        desc: 'Justificatif de paiement — PDF officiel',
        href: `/api/document-view?token=${factureToken}`,
      });
    }

    if (!buttons.length) return res.status(404).send(renderPage('Documents introuvables ou lien expiré.'));
    return res.status(200).send(renderPage(null, { ref, buttons }));
  } catch (e) {
    console.error('[documents-view]', e.message);
    return res.status(500).send(renderPage('Erreur serveur.'));
  }
};
