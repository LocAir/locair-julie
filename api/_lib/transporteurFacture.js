const crypto = require('crypto');
const { generateFactureTransporteurPdf, fmtDate, eur } = require('./pdf');
const { sendBrevoEmail } = require('./brevo');
const { tplFactureTransporteurAdmin, tplRecapFactureHebdoAdmin } = require('./emailTemplates');
const { notifyTransporteur } = require('./transporteurNotif');

// Même bucket que les autres documents (contrats, factures client, avenants)
// — aucun nouveau bucket/policy Supabase Storage nécessaire.
async function uploadPdf(supabase, path, buffer) {
  const { error } = await supabase.storage.from('missions').upload(path, buffer, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (error) throw error;
}

function accessToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Heure de Paris (même approximation acceptable que transporteur-earnings.js
// startOfDayISO — UTC+2, ne gère pas le passage heure d'hiver à la minute
// près, sans conséquence ici : ça décale au pire une mission de minuit d'un
// jour, jamais d'une semaine).
function parisDateKey(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
}

// Bornes [gte, lt) pour une période de dates (YYYY-MM-DD inclus des deux
// côtés) sur une colonne timestamptz — bornes partagées entre le calcul de
// résumé (aperçu avant génération) et la génération réelle, pour ne jamais
// avoir deux définitions différentes de "cette semaine" qui divergent.
function periodeBounds(periodeDebut, periodeFin) {
  const finExclusive = new Date(periodeFin + 'T00:00:00Z');
  finExclusive.setUTCDate(finExclusive.getUTCDate() + 1);
  return {
    gte: `${periodeDebut}T00:00:00+02:00`,
    lt:  finExclusive.toISOString().slice(0, 10) + 'T00:00:00+02:00',
  };
}

const MISSION_TYPE_LABEL = { livraison: 'Livraison', recuperation: 'Récupération', changement: 'Remplacement' };

// Regroupe les missions "fait" par jour (heure de Paris) — détail concis
// demandé par Aly pour la facture PDF (pas mission par mission, déjà
// consultable en détail dans "Mes gains" côté transporteur).
function grouperParJour(missions) {
  const byDay = {};
  for (const m of missions) {
    const key = parisDateKey(m.fait_at);
    (byDay[key] = byDay[key] || []).push(m);
  }
  return Object.keys(byDay).sort().map(key => {
    const items = byDay[key];
    const totalCents = items.reduce((s, m) => s + (m.montant_du_cents || 0), 0);
    const counts = {};
    items.forEach(m => {
      // type='autre' (ex. Prime de fin de saison, voir admin-virements.js) :
      // le titre libre est le libellé le plus parlant, comme côté admin
      // (MISSION_TYPE_LABEL / m.titre||'Mission libre').
      const lbl = m.type === 'autre' ? (m.titre || 'Mission') : (MISSION_TYPE_LABEL[m.type] || m.type);
      counts[lbl] = (counts[lbl] || 0) + 1;
    });
    const detailLabel = Object.entries(counts).map(([lbl, n]) => `${lbl}${n > 1 ? ` ×${n}` : ''}`).join(', ');
    const d = new Date(key + 'T12:00:00');
    const dateLabel = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return {
      dateLabel: dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1),
      count: items.length, totalCents, detailLabel,
    };
  });
}

// Aperçu live (avant génération) : nombre de missions et montant total sur
// une période donnée, sans créer de document — sert à afficher "8 missions,
// 240,00 €" côté transporteur avant qu'il ne valide.
async function resumePeriode(supabase, transporteurId, periodeDebut, periodeFin) {
  const { gte, lt } = periodeBounds(periodeDebut, periodeFin);
  const { data, error } = await supabase
    .from('livraisons').select('montant_du_cents')
    .eq('transporteur_id', transporteurId).eq('statut', 'fait')
    .gte('fait_at', gte).lt('fait_at', lt);
  if (error) throw error;
  const rows = data || [];
  return {
    nb_missions: rows.length,
    montant_total_cents: rows.reduce((s, r) => s + (r.montant_du_cents || 0), 0),
  };
}

// Point d'entrée : génère (si pas déjà fait pour cette période exacte),
// stocke et envoie par email à l'administration la facture hebdomadaire d'un
// transporteur. Idempotent par (transporteur_id, periode_debut, periode_fin)
// — voir l'index unique de la migration : un double clic ne crée jamais 2
// factures pour la même semaine, ça renvoie simplement celle qui existe déjà
// (deja_generee: true) plutôt que d'échouer.
async function genererFactureTransporteur(supabase, { transporteurId, periodeDebut, periodeFin }) {
  const { data: existante } = await supabase
    .from('transporteur_factures').select('*')
    .eq('transporteur_id', transporteurId).eq('periode_debut', periodeDebut).eq('periode_fin', periodeFin)
    .maybeSingle();
  if (existante) return { ...existante, deja_generee: true };

  const { data: transp } = await supabase
    .from('transporteurs').select('id, nom, telephone, siret, adresse_facturation')
    .eq('id', transporteurId).maybeSingle();
  if (!transp) throw new Error('Transporteur introuvable');

  const { gte, lt } = periodeBounds(periodeDebut, periodeFin);
  const { data: missions, error: missionsErr } = await supabase
    .from('livraisons').select('id, type, titre, montant_du_cents, fait_at')
    .eq('transporteur_id', transporteurId).eq('statut', 'fait')
    .gte('fait_at', gte).lt('fait_at', lt)
    .order('fait_at', { ascending: true });
  if (missionsErr) throw missionsErr;
  const rows = missions || [];
  if (!rows.length) {
    const e = new Error('Aucune mission terminée sur cette période — rien à facturer.');
    e.code = 'EMPTY';
    throw e;
  }

  const joursGroupes = grouperParJour(rows);
  const totalCents   = rows.reduce((s, m) => s + (m.montant_du_cents || 0), 0);
  const nbMissions    = rows.length;
  const numero = `FACT-TR${String(transporteurId).padStart(3, '0')}-${periodeDebut.replace(/-/g, '')}`;

  const buffer = await generateFactureTransporteurPdf({
    transporteur: transp, numero, periodeDebut, periodeFin, joursGroupes, totalCents, nbMissions,
  });
  const path = `documents/factures-transporteurs/${numero}.pdf`;
  await uploadPdf(supabase, path, buffer);
  const token = accessToken();

  const { data: inserted, error: insErr } = await supabase.from('transporteur_factures').insert({
    transporteur_id: transporteurId, numero, periode_debut: periodeDebut, periode_fin: periodeFin,
    nb_missions: nbMissions, montant_total_cents: totalCents, storage_path: path, access_token: token,
  }).select().single();
  if (insErr) {
    // Course entre deux appels concurrents (rare, mais possible : double
    // clic, deux onglets) — celle déjà insérée par l'autre appel fait foi.
    if (insErr.code === '23505') {
      const { data: concurrente } = await supabase.from('transporteur_factures').select('*')
        .eq('transporteur_id', transporteurId).eq('periode_debut', periodeDebut).eq('periode_fin', periodeFin).maybeSingle();
      if (concurrente) return { ...concurrente, deja_generee: true };
    }
    throw insErr;
  }

  // Email automatique à l'administration (Aly), PDF en pièce jointe — jamais
  // bloquant : la facture reste générée et consultable (transporteur + admin)
  // même si l'envoi échoue, même principe que les autres documents (voir
  // _lib/documents.js).
  let envoyeeAdmin = false, envoyeeErreur = null;
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'alythiam95@gmail.com';
    const html = tplFactureTransporteurAdmin({
      transporteurNom: transp.nom, numero,
      periodeDebutFmt: fmtDate(periodeDebut), periodeFinFmt: fmtDate(periodeFin),
      nbMissions, totalFmt: eur(totalCents),
    });
    const result = await sendBrevoEmail({
      to: adminEmail,
      subject: `🧾 Facture ${transp.nom} — semaine du ${fmtDate(periodeDebut)}`,
      html,
      attachments: [{ name: `${numero}.pdf`, content: buffer }],
    });
    envoyeeAdmin = !!result.ok;
    if (!result.ok) envoyeeErreur = String(result.error || '').slice(0, 300);
    // Traçage dans email_log — sans ça, cet envoi (comme le récap hebdo
    // ci-dessous) restait invisible de l'onglet Emails et de tout board de
    // suivi, contrairement à tous les autres envois Brevo de l'app (audit
    // communications, 2026-08-19).
    supabase.from('email_log').insert({
      reservation_id: null, scenario: 'email_facture_transporteur_admin', canal: 'email',
      destinataire: adminEmail, modele: 'facture_transporteur_admin',
      statut: envoyeeAdmin ? 'envoye' : 'erreur', erreur: envoyeeAdmin ? null : envoyeeErreur, contenu: html,
    }).then(() => {}, () => {});
  } catch (e) {
    envoyeeErreur = e.message;
    console.error('[Facture transporteur email]', e.message);
  }
  await supabase.from('transporteur_factures')
    .update({ envoyee_admin: envoyeeAdmin, envoyee_erreur: envoyeeErreur }).eq('id', inserted.id);

  return { ...inserted, envoyee_admin: envoyeeAdmin, envoyee_erreur: envoyeeErreur, deja_generee: false };
}

// ── Automatisation du lundi (demande d'Aly, 2026-08-17) ─────────────────────
// Appelée depuis cron-daily.js, seulement le lundi (today.getDay() === 1) —
// même schéma que runWeeklyReport/runMonthlyRecap : un seul cron programmé
// sur ce plan Vercel (voir vercel.json), toute logique "hebdomadaire" se
// déclenche depuis le cron quotidien plutôt que sur sa propre entrée. Tourne
// donc dans la même fenêtre que le reste du cron quotidien (~8h30 heure de
// Paris en été, 6h30 UTC — vercel.json), pas pile 8h00.
//
// Pour chaque transporteur actif :
//  1. RAPPEL — la semaine qui vient de se terminer (lundi dernier→dimanche)
//     a des missions mais pas encore de facture : notification pour qu'il la
//     valide lui-même dans "Mes gains" (aucun envoi automatique cette
//     semaine-là, il a jusqu'au lundi suivant pour agir).
//  2. FILET DE SÉCURITÉ — la semaine d'il y a 2 semaines (donc déjà passée
//     par l'étape 1 il y a une semaine) est TOUJOURS sans facture : générée
//     et envoyée à sa place, pour que rien ne se perde même en cas d'oubli.
// Heure de Paris ignorée ici (semaines entières, UTC suffit — même logique
// que periodLabel dans transporteurNotif.js, déjà en UTC pour cette raison).
function mondayUTC(d) {
  const dow = d.getUTCDay(); // 0=dimanche..6=samedi
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}
function addDaysUTC(d, n) {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function runFactureTransporteurHebdo(supabase, now = new Date()) {
  const mondayThisWeek    = mondayUTC(now);
  const mondayLastWeek    = addDaysUTC(mondayThisWeek, -7);
  const sundayLastWeek    = addDaysUTC(mondayLastWeek, 6);
  const mondayTwoWeeksAgo = addDaysUTC(mondayThisWeek, -14);
  const sundayTwoWeeksAgo = addDaysUTC(mondayTwoWeeksAgo, 6);

  const { data: transporteurs } = await supabase.from('transporteurs').select('id, nom').eq('actif', true);
  const result = { rappels: 0, generees_auto: 0, erreurs: [], recap_lignes: [] };

  for (const t of transporteurs || []) {
    // 1) Rappel — semaine qui vient de finir
    try {
      const pDebut = isoDate(mondayLastWeek), pFin = isoDate(sundayLastWeek);
      const { data: existante } = await supabase.from('transporteur_factures').select('id')
        .eq('transporteur_id', t.id).eq('periode_debut', pDebut).eq('periode_fin', pFin).maybeSingle();
      if (!existante) {
        const resume = await resumePeriode(supabase, t.id, pDebut, pFin);
        if (resume.nb_missions > 0) {
          const montantFmt = eur(resume.montant_total_cents);
          await notifyTransporteur(supabase, t.id, {
            type: 'facture', tag: 'facture_rappel',
            message: `🧾 Ta facture de la semaine passée t'attend : ${resume.nb_missions} mission${resume.nb_missions > 1 ? 's' : ''}, ${montantFmt} — valide-la en 1 clic dans "Mes gains".`,
          });
          result.rappels++;
          result.recap_lignes.push({ nom: t.nom, auto: false, montantFmt, cents: resume.montant_total_cents });
        }
      }
    } catch (e) {
      result.erreurs.push(`rappel #${t.id}: ${e.message}`);
      console.error('[Facture hebdo — rappel]', t.id, e.message);
    }

    // 2) Filet de sécurité — semaine d'il y a 2 semaines, toujours sans facture
    try {
      const pDebut2 = isoDate(mondayTwoWeeksAgo), pFin2 = isoDate(sundayTwoWeeksAgo);
      const { data: existante2 } = await supabase.from('transporteur_factures').select('id')
        .eq('transporteur_id', t.id).eq('periode_debut', pDebut2).eq('periode_fin', pFin2).maybeSingle();
      if (!existante2) {
        const genResult = await genererFactureTransporteur(supabase, { transporteurId: t.id, periodeDebut: pDebut2, periodeFin: pFin2 });
        if (!genResult.deja_generee) {
          result.generees_auto++;
          const montantFmt = eur(genResult.montant_total_cents);
          await notifyTransporteur(supabase, t.id, {
            type: 'facture', tag: 'facture_auto',
            message: `🧾 Ta facture de la semaine du ${fmtDate(pDebut2)} a été générée et envoyée automatiquement (tu n'avais pas encore validé) — tu la retrouves dans "Mes factures".`,
          });
          result.recap_lignes.push({ nom: t.nom, auto: true, montantFmt, cents: genResult.montant_total_cents });
        }
      }
    } catch (e) {
      // EMPTY = aucune mission sur cette période, rien à générer — normal,
      // pas une erreur à signaler.
      if (e.code !== 'EMPTY') {
        result.erreurs.push(`auto #${t.id}: ${e.message}`);
        console.error('[Facture hebdo — auto]', t.id, e.message);
      }
    }
  }

  // Récap admin : le total d'abord (demande d'Aly), le détail par
  // transporteur ensuite. Envoyé une seule fois, seulement s'il y a quelque
  // chose à signaler — pas de mail vide chaque lundi sans activité.
  if (result.recap_lignes.length) {
    try {
      const totalCents = result.recap_lignes.reduce((s, l) => s + l.cents, 0);
      const adminEmail = process.env.ADMIN_EMAIL || 'alythiam95@gmail.com';
      const html = tplRecapFactureHebdoAdmin({
        totalFmt: eur(totalCents), nbTransporteurs: result.recap_lignes.length, lignes: result.recap_lignes,
      });
      const recapResult = await sendBrevoEmail({ to: adminEmail, subject: `🧾 Récap hebdo factures transporteurs — ${eur(totalCents)}`, html });
      if (!recapResult.ok) console.error('[Facture hebdo — récap email]', recapResult.error);
      supabase.from('email_log').insert({
        reservation_id: null, scenario: 'recap_facture_hebdo_admin', canal: 'email',
        destinataire: adminEmail, modele: 'recap_facture_hebdo_admin',
        statut: recapResult.ok ? 'envoye' : 'erreur',
        erreur: recapResult.ok ? null : String(recapResult.error || '').slice(0, 300), contenu: html,
      }).then(() => {}, () => {});
    } catch (e) {
      console.error('[Facture hebdo — récap email]', e.message);
    }
  }

  return result;
}

module.exports = { genererFactureTransporteur, resumePeriode, runFactureTransporteurHebdo };
