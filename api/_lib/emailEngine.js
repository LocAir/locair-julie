const { sendBrevoEmail } = require('./brevo');
const tpl = require('./emailTemplates');

function fmtDateFR(iso) {
  if (!iso) return '—';
  return new Date(String(iso).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Registre central des 8 scénarios — seul endroit qui associe un identifiant
// de scénario à son libellé, son sujet et son gabarit HTML. Le cron
// (cron-daily.js), le webhook Stripe, les actions transporteur et le renvoi
// manuel admin (admin-emails.js) passent TOUS par ce registre : aucun de ces
// appelants ne construit son propre HTML d'email.
const SCENARIOS = {
  confirmation:        { libelle: 'Confirmation de réservation',        subject: ctx => `✅ Réservation confirmée — Dossier ${ctx.ref}`,               template: tpl.tplConfirmation },
  suivi_j14:           { libelle: 'Suivi J-14',                          subject: ctx => `Votre climatiseur arrive dans 14 jours`,                     template: tpl.tplSuiviJ14 },
  preparation_j3:      { libelle: 'Préparation J-3',                     subject: ctx => `Votre livraison Loc'Air approche`,                           template: tpl.tplPreparationJ3 },
  rappel_j1:           { libelle: 'Rappel J-1 (livraison)',              subject: ctx => `📦 Demain, livraison de votre climatiseur Loc'Air`,          template: tpl.tplRappelJ1 },
  post_installation:   { libelle: 'Post-installation',                   subject: ctx => `✅ Votre climatiseur est installé — Dossier ${ctx.ref}`,     template: tpl.tplPostInstallation },
  avant_fin_location:  { libelle: 'Avant fin de location (prolongation)', subject: ctx => `Votre location Loc'Air se termine bientôt`,                 template: tpl.tplAvantFinLocation },
  rappel_recuperation: { libelle: 'Rappel J-1 (récupération)',           subject: ctx => `Récupération de votre climatiseur Loc'Air demain`,          template: tpl.tplRappelRecuperation },
  fin_location:        { libelle: 'Fin de location (avis)',              subject: ctx => `Loc'Air — Location terminée · Merci ${ctx.prenom} !`,       template: tpl.tplFinLocation },
};

// Contexte de variables dynamiques partagé par tous les scénarios — toujours
// résolu au moment de l'envoi (jamais figé à la réservation), donc reflète
// systématiquement les données Supabase les plus récentes (dates modifiées
// par l'admin, appareil réassigné, etc.).
async function buildEmailContext(supabase, reservation) {
  const { data: reservAppareils } = await supabase
    .from('reservation_appareils').select('appareil:appareils(reference)').eq('reservation_id', reservation.id).limit(1);
  const appareil = (reservAppareils || [])[0]?.appareil;

  return {
    ref:      reservation.ref,
    prenom:   reservation.prenom || '',
    nom:      reservation.nom || '',
    adresse:  reservation.adresse || '',
    creneau:  reservation.creneau || '',
    installation: reservation.installation || '',
    dateDebutFmt: fmtDateFR(reservation.date_debut),
    dateFinFmt:   fmtDateFR(reservation.date_fin),
    montantFmt:   ((reservation.prix_total_cents || 0) / 100).toFixed(2).replace('.', ',') + ' €',
    modeleClimatiseur: appareil?.reference || "Climatiseur mobile Loc'Air",
    // Ces deux liens n'ont pas encore de destination dédiée (pas d'espace
    // client, pas de tutoriel client à ce jour) — voir rapport de fin de
    // module. Redirigent vers les ressources publiques les plus proches en
    // attendant.
    lienEspaceClient: 'https://www.locair.fr/#contact',
    lienTutoriel:     'https://www.locair.fr/#faq',
    lienProlongation: `https://www.locair.fr/prolongation?ref=${encodeURIComponent(reservation.ref || '')}`,
  };
}

async function getSignature(supabase) {
  const { data } = await supabase.from('email_signature').select('*').eq('id', 1).maybeSingle();
  return data || { nom_expediteur: "Loc'Air", fonction: null, logo_url: null, telephone: null, email: 'contact@locair.fr', site_web: 'https://www.locair.fr' };
}

function signatureFooterHtml(sig) {
  return `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#888">
    ${sig.logo_url ? `<img src="${sig.logo_url}" alt="" style="max-height:32px;margin-bottom:8px;display:block"/>` : ''}
    <strong>${sig.nom_expediteur}</strong>${sig.fonction ? ' · ' + sig.fonction : ''}<br/>
    ${sig.telephone ? sig.telephone + ' · ' : ''}${sig.email || ''}${sig.site_web ? ' · <a href="' + sig.site_web + '" style="color:#888">' + String(sig.site_web).replace(/^https?:\/\//, '') + '</a>' : ''}
  </div>`;
}

async function isScenarioActive(supabase, scenario) {
  const { data } = await supabase.from('email_scenarios').select('actif').eq('id', scenario).maybeSingle();
  return data ? data.actif !== false : true;
}

async function wasScenarioSent(supabase, reservationId, scenario) {
  const { data } = await supabase
    .from('email_sent').select('reservation_id').eq('reservation_id', reservationId).eq('scenario', scenario).maybeSingle();
  return !!data;
}

// Exclusion posée depuis la fiche client admin (panneau Communications,
// "Mettre en pause"/"Supprimer") — contrairement à wasScenarioSent(), n'est
// JAMAIS contournée par `force` : c'est une décision explicite de l'admin
// sur cet envoi précis, un renvoi manuel accidentel ne doit pas l'écraser.
async function wasScenarioSkipped(supabase, reservationId, scenario) {
  const { data } = await supabase
    .from('email_skip').select('reservation_id').eq('reservation_id', reservationId).eq('scenario', scenario).maybeSingle();
  return !!data;
}

// Point d'entrée unique pour l'envoi d'un email de scénario — garantit :
// scénario actif, jamais deux fois pour la même réservation (sauf `force`,
// réservé au renvoi manuel admin), historique complet (email_log) que
// l'envoi réussisse ou échoue.
async function sendScenarioEmail(supabase, { reservationId, scenario, force = false }) {
  const scenarioDef = SCENARIOS[scenario];
  if (!scenarioDef) return { sent: false, reason: 'unknown_scenario' };

  const { data: reservation } = await supabase.from('reservations').select('*').eq('id', reservationId).maybeSingle();
  if (!reservation) return { sent: false, reason: 'no_reservation' };

  if (!(await isScenarioActive(supabase, scenario))) return { sent: false, reason: 'scenario_disabled' };
  if (await wasScenarioSkipped(supabase, reservationId, scenario)) return { sent: false, reason: 'skipped_by_admin' };
  if (!force && (await wasScenarioSent(supabase, reservationId, scenario))) return { sent: false, reason: 'already_sent' };
  if (!reservation.email) return { sent: false, reason: 'no_email' };

  const ctx = await buildEmailContext(supabase, reservation);
  const sig = await getSignature(supabase);
  const html = scenarioDef.template(ctx) + signatureFooterHtml(sig);
  const subject = scenarioDef.subject(ctx);

  try {
    await sendBrevoEmail({ to: reservation.email, subject, html, senderName: sig.nom_expediteur });
    await supabase.from('email_sent')
      .upsert({ reservation_id: reservationId, scenario, sent_at: new Date().toISOString() }, { onConflict: 'reservation_id,scenario' });
    await supabase.from('email_log').insert({
      reservation_id: reservationId, scenario, destinataire: reservation.email, modele: scenario, statut: 'envoye',
    });
    return { sent: true };
  } catch (e) {
    await supabase.from('email_log').insert({
      reservation_id: reservationId, scenario, destinataire: reservation.email, modele: scenario,
      statut: 'erreur', erreur: String(e.message || e).slice(0, 500),
    });
    return { sent: false, reason: 'error', error: e.message };
  }
}

module.exports = { SCENARIOS, sendScenarioEmail, buildEmailContext, getSignature, signatureFooterHtml, wasScenarioSent, wasScenarioSkipped, isScenarioActive };
