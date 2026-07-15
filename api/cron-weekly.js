const { getSupabase }    = require('./_lib/supabase');
const { sendBrevoEmail } = require('./_lib/brevo');
const { INCIDENT_OPEN_STATUSES } = require('./_lib/incidentStatus');

function verifyCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers['authorization'] || '') === `Bearer ${secret}`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Rapport CA/missions/incidents/virements de la semaine écoulée, envoyé par
// email à l'admin — logique extraite du handler HTTP pour être appelée
// directement depuis cron-daily.js (un seul cron programmé sur ce plan
// Vercel, voir vercel.json) plutôt que comme cron indépendant.
async function runWeeklyReport(supabase) {
  const today    = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const weekAgo  = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);

  {
    // Missions effectuées cette semaine
    const { data: livDone } = await supabase
      .from('livraisons')
      .select('montant_du_cents, type, transporteur_id')
      .eq('statut', 'fait')
      .gte('fait_at', weekAgoStr + 'T00:00:00')
      .lt('fait_at', todayStr + 'T00:00:00');

    const totalCA   = (livDone || []).reduce((s, l) => s + (l.montant_du_cents || 0), 0);
    const nbMissions = (livDone || []).length;
    const nbLiv     = (livDone || []).filter(l => l.type === 'livraison').length;
    const nbRecup   = (livDone || []).filter(l => l.type === 'recuperation').length;

    // Nouvelles réservations
    const { count: newResas } = await supabase
      .from('reservations').select('id', { count: 'exact', head: true })
      .gte('created_at', weekAgoStr + 'T00:00:00').lt('created_at', todayStr + 'T00:00:00')
      .neq('statut', 'annulee');

    // Incidents ouverts
    const { count: incidentsOuverts } = await supabase
      .from('incidents').select('id', { count: 'exact', head: true }).in('statut', INCIDENT_OPEN_STATUSES);

    // Virements en attente
    const { count: virementsEnAttente } = await supabase
      .from('virements').select('id', { count: 'exact', head: true }).eq('statut', 'demande');

    const totalEur = (totalCA / 100).toFixed(2);
    const adminEmail = process.env.ADMIN_EMAIL || 'contact@locair.fr';

    await sendBrevoEmail({
      to:      adminEmail,
      subject: `📊 Rapport hebdo Loc'Air — semaine du ${weekAgoStr}`,
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font-family:Inter,Arial,sans-serif;background:#f4f0ea;margin:0;padding:0}
.wrap{max-width:560px;margin:16px auto;background:#fff;border-radius:16px;overflow:hidden}
.head{background:#1b3a5f;padding:28px 32px;text-align:center}
.head h1{color:#fff;font-size:20px;margin:0 0 4px}
.head p{color:rgba(255,255,255,.7);font-size:13px;margin:0}
.body{padding:24px 32px}
.kpi{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:24px}
.kpi-card{flex:1;min-width:120px;background:#f4f0ea;border-radius:10px;padding:14px 16px;text-align:center}
.kpi-val{font-size:26px;font-weight:700;color:#1b3a5f}
.kpi-lbl{font-size:11px;color:#888;margin-top:4px}
.row{padding:8px 0;border-bottom:1px solid #f0ede8;font-size:13px;display:flex;justify-content:space-between}
.row:last-child{border-bottom:none}
.footer{background:#f4f0ea;padding:16px 32px;text-align:center;font-size:12px;color:#888}
.btn{display:inline-block;background:#1b3a5f;color:#fff;padding:10px 24px;border-radius:100px;text-decoration:none;font-weight:700;font-size:13px;margin-top:16px}
</style></head><body>
<div class="wrap">
<div class="head">
<h1>📊 Rapport hebdomadaire</h1>
<p>Semaine du ${escHtml(weekAgoStr)} au ${escHtml(todayStr)}</p>
</div>
<div class="body">
<div class="kpi">
<div class="kpi-card"><div class="kpi-val">${escHtml(String(newResas || 0))}</div><div class="kpi-lbl">Réservations</div></div>
<div class="kpi-card"><div class="kpi-val">${escHtml(String(nbMissions))}</div><div class="kpi-lbl">Missions faites</div></div>
<div class="kpi-card"><div class="kpi-val">${escHtml(totalEur)} €</div><div class="kpi-lbl">CA transporteurs</div></div>
</div>
<div class="row"><span>Livraisons effectuées</span><strong>${escHtml(String(nbLiv))}</strong></div>
<div class="row"><span>Récupérations effectuées</span><strong>${escHtml(String(nbRecup))}</strong></div>
<div class="row"><span>Incidents ouverts</span><strong style="color:${(incidentsOuverts||0) > 0 ? '#dc2626' : '#16a34a'}">${escHtml(String(incidentsOuverts || 0))}</strong></div>
<div class="row"><span>Virements en attente</span><strong style="color:${(virementsEnAttente||0) > 0 ? '#d97706' : '#16a34a'}">${escHtml(String(virementsEnAttente || 0))}</strong></div>
<div style="text-align:center">
<a class="btn" href="https://www.locair.fr/admin">Ouvrir l'admin →</a>
</div>
</div>
<div class="footer">© 2026 Loc'Air · Rapport automatique chaque lundi</div>
</div></body></html>`,
    });

    return { date: todayStr, nbMissions, totalCA, newResas };
  }
}

// Conservé comme endpoint indépendant (déclenchable manuellement avec
// CRON_SECRET) même si non planifié directement — voir cron-daily.js qui
// l'appelle chaque lundi.
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Non autorisé' });
  try {
    const report = await runWeeklyReport(getSupabase());
    return res.status(200).json({ ok: true, ...report });
  } catch (err) {
    console.error('[Cron weekly]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
module.exports.runWeeklyReport = runWeeklyReport;
