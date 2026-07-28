// Endpoint interne — reçoit le rapport de scan quotidien et l'envoie par email via Brevo.
// Protégé par SCAN_SECRET (variable d'environnement Vercel).
const { sendBrevoEmail } = require('./_lib/brevo');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = process.env.SCAN_SECRET;
  if (!secret || req.headers['x-scan-secret'] !== secret) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const { rapport, date } = req.body || {};
  if (!rapport) return res.status(400).json({ error: 'rapport manquant' });

  const dateStr = date || new Date().toLocaleDateString('fr-FR');
  const lignes = rapport.split('\n').map(l => `<p style="margin:4px 0;font-family:monospace;font-size:13px">${l.replace(/</g,'&lt;')}</p>`).join('');

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="color:#1b3558;margin:0 0 4px">🔍 Scan quotidien Loc'Air</h2>
      <p style="color:#6e8599;font-size:13px;margin:0 0 24px">${dateStr}</p>
      <div style="background:#f8f8f8;border-radius:8px;padding:16px 20px;border-left:4px solid #1b3558">
        ${lignes}
      </div>
      <p style="color:#6e8599;font-size:11px;margin-top:24px">
        Rapport automatique — site locair.fr
      </p>
    </div>
  `;

  const result = await sendBrevoEmail({
    to: 'alythiam95@gmail.com',
    subject: `Scan Loc'Air — ${dateStr}`,
    html,
  });

  if (!result.ok) return res.status(500).json({ error: result.error });
  res.json({ ok: true });
};
