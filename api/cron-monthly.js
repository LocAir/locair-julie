const crypto = require('crypto');
const { getSupabase }              = require('./_lib/supabase');
const { sendBrevoEmail, sendBrevoSms } = require('./_lib/brevo');
const { getSignature, withSignature } = require('./_lib/emailEngine');
const { tplRelanceDormant } = require('./_lib/emailTemplates');
const { promoCodeForPrenom } = require('./_lib/promo');
const { isSupersededReservation } = require('./_lib/emailSchedule');

function verifyCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = req.headers['authorization'] || '';
  const expected = `Bearer ${secret}`;
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
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
  const todayStr = today.toISOString().slice(0, 10);
  // Mois précédent
  const firstOfThisMonth  = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstOfLastMonth  = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const startStr = firstOfLastMonth.toISOString().slice(0, 10);
  const endStr   = firstOfThisMonth.toISOString().slice(0, 10);
  const nomMois  = MOIS_FR[firstOfLastMonth.getMonth()];
  const annee    = firstOfLastMonth.getFullYear();

  // Verrou idempotent (même pattern que runWeeklyReport) : ce cron reste
  // déclenchable manuellement avec CRON_SECRET en plus de l'appel
  // automatique du 1er du mois — sans ce verrou, un déclenchement manuel le
  // même jour renvoie un 2e SMS "montant à virer" à chaque transporteur et
  // un 2e email récap à l'admin.
  const { data: dejaSent } = await supabase
    .from('email_log')
    .select('id')
    .eq('scenario', 'recap_mensuel_virements')
    .gte('sent_at', todayStr + 'T00:00:00Z')
    .maybeSingle();
  if (dejaSent) return { skipped: true, reason: 'already_sent_today' };

  {
    // Toutes les missions faites le mois dernier avec transporteur
    const { data: livraisons } = await supabase
      .from('livraisons')
      .select('transporteur_id, montant_du_cents, type')
      .eq('statut', 'fait')
      .gte('fait_at', startStr + 'T00:00:00Z')
      .lt('fait_at', endStr + 'T00:00:00Z')
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
      subject: `Virements à effectuer — ${nomMois} ${annee}`,
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font-family:'DM Sans',Arial,sans-serif;background:#F4F7FC;margin:0;padding:0}
.wrap{max-width:560px;margin:16px auto;background:#fff;border-radius:16px;overflow:hidden}
.head{background:#1A5EDB;padding:28px 32px;text-align:center}
.head h1{color:#fff;font-size:20px;margin:0 0 4px}
.head p{color:rgba(255,255,255,.75);font-size:13px;margin:0}
.body{padding:24px 32px}
.total-box{background:#EFF4FD;border:1px solid #DDE6F5;border-radius:10px;padding:16px;text-align:center;margin-bottom:20px}
.total-val{font-size:28px;font-weight:700;color:#1A5EDB}
.row{padding:10px 0;border-bottom:1px solid #DDE6F5;font-size:13px;display:flex;justify-content:space-between;align-items:center}
.row:last-child{border-bottom:none}
.footer{background:#F4F7FC;padding:16px 32px;text-align:center;font-size:12px;color:#888}
.btn{display:inline-block;background:#1A5EDB;color:#fff;padding:10px 24px;border-radius:100px;text-decoration:none;font-weight:700;font-size:13px;margin-top:16px}
</style></head><body>
<div class="wrap">
<div class="head">
<h1>Récapitulatif virements</h1>
<p>${escHtml(nomMois)} ${annee} · ${escHtml(String(entries.length))} transporteur${entries.length > 1 ? 's' : ''}</p>
</div>
<div class="body">
<div class="total-box">
<div style="font-size:12px;color:#1A5EDB;margin-bottom:4px">TOTAL À VIRER</div>
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

    const { error: logError } = await supabase.from('email_log').insert({
      scenario: 'recap_mensuel_virements', canal: 'email', destinataire: adminEmail,
      modele: 'recap_mensuel_virements', statut: 'envoye', sent_at: new Date().toISOString(),
    });
    if (logError) throw new Error('[recap_mensuel_virements log] ' + logError.message);

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

  let resas = [];
  let offset = 0;
  while (true) {
    const { data: batch } = await supabase
      .from('reservations')
      .select('id, client_id, statut, date_debut, date_fin, mkt_consent, prenom, email, source, reservation_origine_id, lang')
      .not('client_id', 'is', null)
      .range(offset, offset + 999);
    if (!batch || !batch.length) break;
    resas = resas.concat(batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }

  // Groupe par client pour pouvoir écarter les fiches supplantées par une
  // prolongation plus récente (voir isSupersededReservation,
  // _lib/emailSchedule.js) : une réservation "d'origine" reste 'confirmee'
  // pour toujours après une prolongation, alors que le vrai dernier séjour
  // (celui qui compte vraiment pour juger un client "dormant") est la
  // prolongation elle-même, passée 'terminee' à la récupération réelle. Sans
  // ce filtre, le client restait à tort exclu de la relance (sa fiche
  // d'origine ne passe jamais à 'terminee').
  const parClientId = {};
  for (const r of (resas || [])) (parClientId[r.client_id] = parClientId[r.client_id] || []).push(r);

  const parClient = {};
  for (const r of resas || []) {
    if (isSupersededReservation(r, parClientId[r.client_id])) continue;
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

    // Ne compte que les envois réussis : une ligne 'erreur' (Brevo en panne
    // ou en quota ce jour-là) ne doit pas exclure définitivement ce client
    // de toute relance commerciale future.
    const { count: dejaRelance } = await supabase
      .from('email_log').select('id', { count: 'exact', head: true })
      .eq('reservation_id', dernier.id).eq('scenario', 'relance_dormant').eq('statut', 'envoye');
    if (dejaRelance) continue;

    // Audit 2026-08-06 I13 : promoCodeForPrenom(null, 20) retournait '20',
    // créant un code générique utilisable par n'importe qui avec -20%.
    // On ne devrait jamais arriver ici sans prenom (filtre plus haut) mais
    // double garde par précaution.
    if (!dernier.prenom) continue;
    const codePromo = promoCodeForPrenom(dernier.prenom, 20);
    const sig = await getSignature(supabase);
    const lang = dernier.lang || 'fr';
    const html = withSignature(tplRelanceDormant({ prenom: dernier.prenom, codePromo, lang }), sig);
    const subject = lang === 'en'
      ? `${dernier.prenom ? dernier.prenom + ', a' : 'A'} discount is waiting for you at Loc'Air`
      : lang === 'zh'
      ? `${dernier.prenom ? dernier.prenom + '，' : ''}Loc'Air 专属优惠等您来领取`
      : lang === 'ru'
      ? `${dernier.prenom ? dernier.prenom + ', вас' : 'Вас'} ждёт скидка в Loc'Air`
      : `${dernier.prenom ? dernier.prenom + ', une' : 'Une'} réduction vous attend chez Loc'Air`;
    const result = await sendBrevoEmail({
      to: dernier.email, senderName: sig.nom_expediteur,
      subject,
      html,
    });
    await supabase.from('email_log').insert({
      reservation_id: dernier.id, scenario: 'relance_dormant', canal: 'email',
      destinataire: dernier.email, modele: 'relance_dormant',
      statut: result.ok ? 'envoye' : 'erreur',
      erreur: result.ok ? null : String(result.error || '').slice(0, 500),
      contenu: html,
    }).then(() => {}, () => {});
    if (result.ok) relanceCount++;
  }
  return { relancesDormants: relanceCount };
}

// Commissions partenaires : virées UNE FOIS PAR MOIS (plus de bouton
// « Demander le virement »). Le 1er du mois, l'admin reçoit la liste des
// partenaires à payer avec leur montant et s'il manque le RIB. Le virement
// lui-même reste fait à la main, puis marqué « versé » dans l'admin
// (onglet Partenaires), ce qui prévient le partenaire par email.
async function runRecapPartenaires(supabase) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const { data: dejaSent } = await supabase
    .from('email_log').select('id')
    .eq('scenario', 'recap_mensuel_partenaires')
    .gte('sent_at', todayStr + 'T00:00:00Z')
    .maybeSingle();
  if (dejaSent) return { skipped: true, reason: 'already_sent_today' };

  const { data: resas } = await supabase
    .from('reservations')
    .select('partenaire_id, partenaire_commission_cents')
    .not('partenaire_id', 'is', null)
    .in('statut', ['confirmee', 'terminee']).eq('masquee', false)
    .eq('partenaire_commission_payee', false)
    .gt('partenaire_commission_cents', 0);
  if (!resas || !resas.length) return { message: 'Aucune commission à virer' };

  const dus = {};
  for (const r of resas) dus[r.partenaire_id] = (dus[r.partenaire_id] || 0) + (r.partenaire_commission_cents || 0);
  const { data: partenaires } = await supabase
    .from('partenaires').select('id, nom, iban').in('id', Object.keys(dus).map(Number));
  const entries = (partenaires || [])
    .map(p => ({ nom: p.nom, iban: !!(p.iban && String(p.iban).trim()), total: dus[p.id] || 0 }))
    .filter(e => e.total > 0)
    .sort((a, b) => b.total - a.total);
  if (!entries.length) return { message: 'Aucune commission à virer' };

  const grandTotal = entries.reduce((s, e) => s + e.total, 0);
  const sansRib = entries.filter(e => !e.iban).length;
  const now = new Date();
  const moisPrec = MOIS_FR[new Date(now.getFullYear(), now.getMonth() - 1, 1).getMonth()];
  const adminEmail = process.env.ADMIN_EMAIL || 'contact@locair.fr';
  const rows = entries.map(e =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #eee">${escHtml(e.nom)}${e.iban ? '' : '<br><small style="color:#B42318">RIB manquant : à lui demander</small>'}</td><td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right"><strong>${(e.total / 100).toFixed(2).replace('.', ',')} €</strong></td></tr>`
  ).join('');

  await sendBrevoEmail({
    to: adminEmail,
    subject: `Commissions partenaires à virer — fin ${moisPrec}`,
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;background:#F4F7FC;margin:0;padding:16px">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:24px 28px">
<h1 style="font-size:20px;margin:0 0 6px">Virement mensuel des partenaires</h1>
<p style="color:#555;font-size:14px;margin:0 0 16px">${entries.length} partenaire${entries.length > 1 ? 's' : ''} à payer · total <strong>${(grandTotal / 100).toFixed(2).replace('.', ',')} €</strong>${sansRib ? ` · <span style="color:#B42318">${sansRib} sans RIB</span>` : ''}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
<p style="font-size:13px;color:#555;margin:16px 0 0">Faites les virements depuis votre banque, puis cliquez « Marquer versé » pour chacun dans l'admin (onglet Partenaires) : le partenaire reçoit un email de confirmation.</p>
<p style="text-align:center;margin:20px 0 0"><a href="https://www.locair.fr/admin" style="background:#1A5EDB;color:#fff;padding:10px 24px;border-radius:100px;text-decoration:none;font-weight:700;font-size:13px">Ouvrir l'admin →</a></p>
</div></body></html>`,
  });
  const { error: logError } = await supabase.from('email_log').insert({
    scenario: 'recap_mensuel_partenaires', canal: 'email', destinataire: adminEmail,
    modele: 'recap_mensuel_partenaires', statut: 'envoye', sent_at: new Date().toISOString(),
  });
  if (logError) throw new Error('[recap_mensuel_partenaires log] ' + logError.message);
  return { partenaires: entries.length, total_cents: grandTotal, sans_rib: sansRib };
}

// Relevé récapitulatif envoyé à CHAQUE commerçant le 1er du mois
// (convention, art. 2 : « versées par virement entre le 1er et le 5 du mois
// suivant sur relevé récapitulatif » ; les encaissements de mai figurent sur
// le relevé de juin). Locations payées le mois précédent (heure de Paris),
// annulées et remboursées exclues. Une seule fois par commerçant et par mois.
async function runReleveCommercants(supabase) {
  const { debutJourParisISO, todayParis } = require('./_lib/dates');
  const auj = todayParis();
  const [y, m] = auj.split('-').map(Number);
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  const debut = debutJourParisISO(`${py}-${String(pm).padStart(2, '0')}-01`);
  const fin = debutJourParisISO(`${y}-${String(m).padStart(2, '0')}-01`);
  const mois = MOIS_FR[pm - 1], moisVirement = MOIS_FR[m - 1];
  const cle = `releve_partenaire_${py}-${String(pm).padStart(2, '0')}`;

  const { data: resas, error } = await supabase.from('reservations')
    .select('partenaire_id, prix_total_cents, partenaire_commission_cents, source, created_at')
    .not('partenaire_id', 'is', null).in('statut', ['confirmee', 'terminee']).eq('masquee', false)
    .gte('created_at', debut).lt('created_at', fin);
  if (error) throw error;
  const par = {};
  for (const r of resas || []) {
    if (!(r.partenaire_commission_cents > 0)) continue;
    const x = par[r.partenaire_id] || (par[r.partenaire_id] = { locations: 0, ca: 0, com: 0 });
    if (r.source !== 'site_prolongation') x.locations++;
    x.ca += r.prix_total_cents || 0; x.com += r.partenaire_commission_cents || 0;
  }
  const ids = Object.keys(par).map(Number);
  if (!ids.length) return { envoyes: 0 };
  const { data: partenaires } = await supabase.from('partenaires').select('id, nom, email, iban, actif').in('id', ids);
  const eur = (c) => (c / 100).toFixed(2).replace('.', ',') + ' €';
  let envoyes = 0;
  for (const p of partenaires || []) {
    if (!p.email || p.actif === false) continue;
    const { data: deja } = await supabase.from('email_log').select('id').eq('scenario', cle).eq('destinataire', p.email).limit(1);
    if (deja && deja.length) continue;
    const x = par[p.id], ribOk = !!(p.iban && String(p.iban).trim());
    const ligne = (k, v, fort) => `<tr><td style="padding:10px 0;border-bottom:1px solid #E3E9F4;color:#4B5873">${k}</td><td style="padding:10px 0;border-bottom:1px solid #E3E9F4;text-align:right${fort ? ';font-size:18px' : ''}"><b>${v}</b></td></tr>`;
    const html = `<div style="font-family:Arial,sans-serif;color:#0E1726;max-width:560px">
<h2 style="color:#1A5EDB;margin:0 0 6px">Votre relevé de ${escHtml(mois)}</h2>
<p style="margin:0 0 14px;color:#4B5873">${escHtml(p.nom || '')}</p>
<table style="width:100%;border-collapse:collapse;font-size:15px">
${ligne('Locations', String(x.locations))}${ligne('Encaissé par Loc’Air', eur(x.ca))}${ligne('Votre part', eur(x.com), true)}
</table>
<p style="margin:16px 0">${ribOk ? `Virement entre le 1<sup>er</sup> et le 5 ${escHtml(moisVirement)}.` : `<b style="color:#B42318">Il nous manque votre RIB.</b> Répondez à cet email avec votre RIB : on vous vire aussitôt.`}</p>
<p style="margin:16px 0"><a href="https://www.locair.fr/partenaire" style="display:inline-block;background:#1A5EDB;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:100px">Mon espace</a></p>
<p style="color:#4B5873;font-size:13px">Loc’Air · 06 63 79 87 56 · partenaires.locair@outlook.com</p></div>`;
    const r = await sendBrevoEmail({ to: p.email, subject: `Votre relevé Loc’Air de ${mois} : ${eur(x.com)}`, html, senderName: "Loc'Air", replyTo: 'partenaires.locair@outlook.com' }).catch((e) => ({ ok: false, error: e.message }));
    await supabase.from('email_log').insert({ scenario: cle, canal: 'email', destinataire: p.email, modele: 'releve_partenaire', statut: r && r.ok ? 'envoye' : 'erreur', sent_at: new Date().toISOString() }).then(() => {}, () => {});
    if (r && r.ok) envoyes++;
  }
  return { envoyes };
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
module.exports.runRecapPartenaires = runRecapPartenaires;
module.exports.runReleveCommercants = runReleveCommercants;
