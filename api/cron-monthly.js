const { getSupabase }              = require('./_lib/supabase');
const { sendBrevoEmail, sendBrevoSms } = require('./_lib/brevo');
const { getSignature, withSignature } = require('./_lib/emailEngine');
const { tplRelanceDormant } = require('./_lib/emailTemplates');
const { promoCodeForPrenom } = require('./_lib/promo');

function verifyCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers['authorization'] || '') === `Bearer ${secret}`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

// Récap mensuel des montants dus par transporteur (email admin + SMS à
// chacun) — logique extraite du handler HTTP pour être appelée directement
// depuis cron-daily.js le 1er de chaque mois (un seul cron programmé sur ce
// plan Vercel, voir vercel.json).
async function runMonthlyRecap(supabase) {
  const today    = new Date();
  // Mois précédent
  const firstOfThisMonth  = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstOfLastMonth  = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const startStr = firstOfLastMonth.toISOString().slice(0, 10);
  const endStr   = firstOfThisMonth.toISOString().slice(0, 10);
  const nomMois  = MOIS_FR[firstOfLastMonth.getMonth()];
  const annee    = firstOfLastMonth.getFullYear();

  {
    // Toutes les missions faites le mois dernier avec transporteur
    const { data: livraisons } = await supabase
      .from('livraisons')
      .select('transporteur_id, montant_du_cents, type')
      .eq('statut', 'fait')
      .gte('fait_at', startStr + 'T00:00:00')
      .lt('fait_at', endStr + 'T00:00:00')
      .not('transporteur_id', 'is', null)
      .gt('montant_du_cents', 0);

    if (!livraisons || !livraisons.length) {
      return { message: 'Aucune mission ce mois-ci' };
    }

    // Grouper par transporteur
    const byTransp = {};
    for (const liv of livraisons) {
      if (!byTransp[liv.transporteur_id]) byTransp[liv.transporteur_id] = { total: 0, nb: 0 };
      byTransp[liv.transporteur_id].total += liv.montant_du_cents || 0;
      byTransp[liv.transporteur_id].nb++;
    }

    const tids = Object.keys(byTransp).map(Number);
    const { data: transporteurs } = await supabase
      .from('transporteurs').select('id, nom, telephone, email').in('id', tids);

    const entries = (transporteurs || []).map(t => ({
      nom:       t.nom,
      telephone: t.telephone,
      email:     t.email,
      total: byTransp[t.id]?.total || 0,
      nb:    byTransp[t.id]?.nb    || 0,
    })).sort((a, b) => b.total - a.total);

    const grandTotal = entries.reduce((s, e) => s + e.total, 0);
    const adminEmail = process.env.ADMIN_EMAIL || 'contact@locair.fr';

    // Email récapitulatif à l'admin
    const rows = entries.map(e =>
      `<div class="row"><span>${escHtml(e.nom)}<br><small style="color:#888">${e.nb} mission${e.nb > 1 ? 's' : ''}</small></span><strong>${(e.total / 100).toFixed(2)} €</strong></div>`
    ).join('');

    await sendBrevoEmail({
      to:      adminEmail,
      subject: `💶 Virements à effectuer — ${nomMois} ${annee}`,
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font-family:Inter,Arial,sans-serif;background:#f4f0ea;margin:0;padding:0}
.wrap{max-width:560px;margin:16px auto;background:#fff;border-radius:16px;overflow:hidden}
.head{background:#0f766e;padding:28px 32px;text-align:center}
.head h1{color:#fff;font-size:20px;margin:0 0 4px}
.head p{color:rgba(255,255,255,.75);font-size:13px;margin:0}
.body{padding:24px 32px}
.total-box{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;text-align:center;margin-bottom:20px}
.total-val{font-size:28px;font-weight:700;color:#0f766e}
.row{padding:10px 0;border-bottom:1px solid #f0ede8;font-size:13px;display:flex;justify-content:space-between;align-items:center}
.row:last-child{border-bottom:none}
.footer{background:#f4f0ea;padding:16px 32px;text-align:center;font-size:12px;color:#888}
.btn{display:inline-block;background:#0f766e;color:#fff;padding:10px 24px;border-radius:100px;text-decoration:none;font-weight:700;font-size:13px;margin-top:16px}
</style></head><body>
<div class="wrap">
<div class="head">
<h1>💶 Récapitulatif virements</h1>
<p>${escHtml(nomMois)} ${annee} · ${escHtml(String(entries.length))} transporteur${entries.length > 1 ? 's' : ''}</p>
</div>
<div class="body">
<div class="total-box">
<div style="font-size:12px;color:#0f766e;margin-bottom:4px">TOTAL À VIRER</div>
<div class="total-val">${(grandTotal / 100).toFixed(2)} €</div>
</div>
${rows}
<div style="text-align:center">
<a class="btn" href="https://www.locair.fr/admin">Gérer les virements →</a>
</div>
</div>
<div class="footer">© 2026 Loc'Air · Récapitulatif automatique le 1er de chaque mois</div>
</div></body></html>`,
    });

    // SMS à chaque transporteur avec son total
    for (const entry of entries) {
      if (!entry.telephone) continue;
      const totalEur = (entry.total / 100).toFixed(2);
      await sendBrevoSms({
        to:      entry.telephone,
        content: `Loc'Air : récap ${nomMois} ${annee} — ${entry.nb} mission${entry.nb > 1 ? 's' : ''}, total : ${totalEur} €. Virement en cours de préparation. Questions : 06 63 79 87 56`,
      }).catch(() => {});
    }

    return { mois: `${nomMois} ${annee}`, nb: entries.length, grandTotal };
  }
}

// Relance commerciale des clients dormants (Module 8) — un client qui a
// déjà loué mais plus depuis 6 mois ne recevait jusqu'ici jamais de
// relance. Un seul enregistrement par client (sa réservation la plus
// récente par date_fin) détermine s'il est dormant. La relance pointe
// toujours vers CETTE réservation dans email_log (scenario
// 'relance_dormant') — comme elle reste "la plus récente" tant que le
// client n'a pas reloué, un simple "jamais encore relancé pour cette
// réservation précise" suffit à ne jamais spammer deux fois pour la même
// période de dormance, sans fenêtre de temps à gérer ni colonne
// supplémentaire.
async function runDormantClientsWinback(supabase) {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const sixMonthsAgoStr = sixMonthsAgo.toISOString().slice(0, 10);

  const { data: resas } = await supabase
    .from('reservations')
    .select('id, client_id, statut, date_fin, mkt_consent, prenom, email')
    .not('client_id', 'is', null);

  const parClient = {};
  for (const r of resas || []) {
    const cur = parClient[r.client_id];
    if (!cur || r.date_fin > cur.date_fin) parClient[r.client_id] = r;
  }

  let relanceCount = 0;
  for (const dernier of Object.values(parClient)) {
    if (dernier.statut !== 'terminee') continue;
    if (dernier.date_fin >= sixMonthsAgoStr) continue;
    // RGPD : seuls les clients ayant explicitement consenti au marketing
    // sur leur dernière réservation reçoivent cette relance.
    if (!dernier.mkt_consent || !dernier.email) continue;

    const { count: dejaRelance } = await supabase
      .from('email_log').select('id', { count: 'exact', head: true })
      .eq('reservation_id', dernier.id).eq('scenario', 'relance_dormant');
    if (dejaRelance) continue;

    const codePromo = promoCodeForPrenom(dernier.prenom, 20);
    const sig = await getSignature(supabase);
    const html = withSignature(tplRelanceDormant({ prenom: dernier.prenom, codePromo }), sig);
    const result = await sendBrevoEmail({
      to: dernier.email, senderName: sig.nom_expediteur,
      subject: `☀️ ${dernier.prenom ? dernier.prenom + ', une' : 'Une'} réduction vous attend chez Loc'Air`,
      html,
    });
    await supabase.from('email_log').insert({
      reservation_id: dernier.id, scenario: 'relance_dormant', canal: 'email',
      destinataire: dernier.email, modele: 'relance_dormant',
      statut: result.ok ? 'envoye' : 'erreur',
      erreur: result.ok ? null : String(result.error || '').slice(0, 500),
      contenu: html,
    }).catch(() => {});
    if (result.ok) relanceCount++;
  }
  return { relancesDormants: relanceCount };
}

// Conservé comme endpoint indépendant (déclenchable manuellement avec
// CRON_SECRET) même si non planifié directement — voir cron-daily.js qui
// l'appelle le 1er de chaque mois.
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Non autorisé' });
  try {
    const report = await runMonthlyRecap(getSupabase());
    return res.status(200).json({ ok: true, ...report });
  } catch (err) {
    console.error('[Cron monthly]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
module.exports.runMonthlyRecap = runMonthlyRecap;
module.exports.runDormantClientsWinback = runDormantClientsWinback;
