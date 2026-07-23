const { sendBrevoEmail } = require('./brevo');
const tpl = require('./emailTemplates');
const { addDays } = require('./dates');

function fmtDate(iso, lang) {
  if (!iso) return '—';
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
  if (lang === 'en') return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  if (lang === 'zh') {
    const days = ['周日','周一','周二','周三','周四','周五','周六'];
    const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    return `${d.getUTCFullYear()}年${months[d.getUTCMonth()]}${d.getUTCDate()}日（${days[d.getUTCDay()]}）`;
  }
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Alias pour les appelants existants qui utilisent encore fmtDateFR
function fmtDateFR(iso) { return fmtDate(iso, 'fr'); }

// Registre central des 8 scénarios — seul endroit qui associe un identifiant
// de scénario à son libellé, son sujet et son gabarit HTML.
const SCENARIOS = {
  confirmation:        { libelle: 'Confirmation de réservation',
    subject: ctx => ctx.lang === 'en' ? `✅ Booking confirmed — Ref ${ctx.ref}` : ctx.lang === 'zh' ? `✅ 预订已确认 — 订单 ${ctx.ref}` : `✅ Réservation confirmée — Dossier ${ctx.ref}`,
    template: tpl.tplConfirmation },
  suivi_j14:           { libelle: 'Suivi J-14',
    subject: ctx => ctx.lang === 'en' ? 'Your AC arrives in 14 days' : ctx.lang === 'zh' ? '您的空调将在14天后送达' : 'Votre climatiseur arrive dans 14 jours',
    template: tpl.tplSuiviJ14 },
  preparation_j3:      { libelle: 'Préparation J-3',
    subject: ctx => ctx.lang === 'en' ? "Your Loc'Air delivery is coming up" : ctx.lang === 'zh' ? '您的Loc\'Air配送即将到来' : "Votre livraison Loc'Air approche",
    template: tpl.tplPreparationJ3 },
  rappel_j1:           { libelle: 'Rappel J-1 (livraison)',
    subject: ctx => ctx.lang === 'en' ? "📦 Tomorrow — your Loc'Air AC is delivered" : ctx.lang === 'zh' ? "📦 明天——您的Loc'Air空调将送达" : "📦 Demain, livraison de votre climatiseur Loc'Air",
    template: tpl.tplRappelJ1 },
  post_installation:   { libelle: 'Post-installation',
    subject: ctx => ctx.lang === 'en' ? `✅ Your AC is installed — Ref ${ctx.ref}` : ctx.lang === 'zh' ? `✅ 您的空调已安装 — 订单 ${ctx.ref}` : `✅ Votre climatiseur est installé — Dossier ${ctx.ref}`,
    template: tpl.tplPostInstallation },
  avant_fin_location:  { libelle: 'Avant fin de location (prolongation)',
    subject: ctx => ctx.lang === 'en' ? "Your Loc'Air rental is ending soon" : ctx.lang === 'zh' ? "您的Loc'Air租赁即将结束" : "Votre location Loc'Air se termine bientôt",
    template: tpl.tplAvantFinLocation },
  rappel_recuperation: { libelle: 'Rappel J-1 (récupération)',
    subject: ctx => ctx.lang === 'en' ? "Your Loc'Air AC is collected tomorrow" : ctx.lang === 'zh' ? "明天将取回您的Loc'Air空调" : "Récupération de votre climatiseur Loc'Air demain",
    template: tpl.tplRappelRecuperation },
  fin_location:        { libelle: 'Fin de location (avis)',
    subject: ctx => ctx.lang === 'en' ? `Loc'Air — Rental complete · Thank you ${ctx.prenom}!` : ctx.lang === 'zh' ? `Loc'Air — 租赁已完成 · 感谢 ${ctx.prenom}！` : `Loc'Air — Location terminée · Merci ${ctx.prenom} !`,
    template: tpl.tplFinLocation },
};

async function buildEmailContext(supabase, reservation) {
  const { data: reservAppareils } = await supabase
    .from('reservation_appareils').select('appareil:appareils(reference)').eq('reservation_id', reservation.id).limit(1);
  const appareil = (reservAppareils || [])[0]?.appareil;
  const lang = reservation.lang || 'fr';
  const _prixBase = (reservation.prix_total_cents || 0) / 100;

  return {
    ref:      reservation.ref,
    prenom:   reservation.prenom || '',
    nom:      reservation.nom || '',
    adresse:  reservation.adresse || '',
    creneau:  reservation.creneau || '',
    installation: reservation.installation || '',
    lang,
    dateDebutFmt: fmtDate(reservation.date_debut, lang),
    dateFinFmt:   fmtDate(reservation.date_fin, lang),
    // La mission de récupération réelle est le lendemain de date_fin (voir
    // confirmReservation dans _lib/reservations.js) — utilisé par le rappel
    // rappel_recuperation, qui part le jour de date_fin pour annoncer le
    // passage du technicien "demain".
    dateRecupFmt: fmtDate(reservation.date_fin ? addDays(reservation.date_fin, 1) : null, lang),
    montantFmt:   lang === 'fr'
      ? _prixBase.toFixed(2).replace('.', ',') + ' €'
      : '€' + _prixBase.toFixed(2),
    modeleClimatiseur: appareil?.reference || "Climatiseur mobile Loc'Air",
    lienEspaceClient: 'https://www.locair.fr/#contact',
    lienTutoriel:     'https://www.locair.fr/#faq',
    lienProlongation: `https://www.locair.fr/prolongation?ref=${encodeURIComponent(reservation.ref || '')}`,
  };
}

async function getSignature(supabase) {
  const { data } = await supabase.from('email_signature').select('*').eq('id', 1).maybeSingle();
  return data || { nom_expediteur: "Loc'Air", fonction: null, logo_url: null, telephone: null, email: 'contact@locair.fr', site_web: 'https://www.locair.fr' };
}

// Même contenu et mêmes champs qu'avant — seule la mise en forme est
// affinée (hiérarchie de couleurs, liseré teinté à la couleur de marque
// plutôt qu'un gris neutre) pour rester cohérente avec le nouvel habillage
// visuel de wrap() (voir _lib/emailTemplates.js).
function signatureFooterHtml(sig) {
  return `<div style="margin-top:26px;padding-top:18px;border-top:1px solid rgba(27,58,95,.12);font-size:12.5px;color:#8a8a8f;line-height:1.6">
    ${sig.logo_url ? `<img src="${sig.logo_url}" alt="" style="max-height:32px;margin-bottom:10px;display:block"/>` : ''}
    <strong style="color:#3a3a3e;font-weight:700">${sig.nom_expediteur}</strong>${sig.fonction ? ' · ' + sig.fonction : ''}<br/>
    ${sig.telephone ? sig.telephone + ' · ' : ''}${sig.email || ''}${sig.site_web ? ' · <a href="' + sig.site_web + '" style="color:#8a8a8f">' + String(sig.site_web).replace(/^https?:\/\//, '') + '</a>' : ''}
  </div>`;
}

// Insère la signature À L'INTÉRIEUR de la carte email (avant la fermeture de
// .wrap), au lieu de la coller après le </html> — ce que faisait partout un
// simple `template(ctx) + signatureFooterHtml(sig)` : la signature atterrissait
// hors de la carte blanche, sur le fond de page brut, visuellement détachée
// du reste de l'email. Tous les points d'envoi doivent utiliser cette
// fonction plutôt que concaténer signatureFooterHtml() directement.
function withSignature(html, sig) {
  const footer = signatureFooterHtml(sig);
  const closing = '</div></body></html>';
  if (html.includes(closing)) return html.replace(closing, `${footer}${closing}`);
  return html + footer; // gabarit imprévu sans cette fermeture exacte — filet de sécurité
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

async function wasScenarioSkipped(supabase, reservationId, scenario) {
  const { data } = await supabase
    .from('email_skip').select('reservation_id').eq('reservation_id', reservationId).eq('scenario', scenario).maybeSingle();
  return !!data;
}

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
  const html = withSignature(scenarioDef.template(ctx), sig);
  const subject = scenarioDef.subject(ctx);

  try {
    const result = await sendBrevoEmail({ to: reservation.email, subject, html, senderName: sig.nom_expediteur });
    // sendBrevoEmail ne jette jamais (voir _lib/brevo.js) — sans cette
    // vérification, un échec réel (clé Brevo invalide, adresse rejetée,
    // quota dépassé, panne API) tombait dans le bloc "succès" ci-dessous :
    // la réservation était marquée comme "email envoyé" alors qu'aucun mail
    // n'était réellement parti, sans jamais apparaître comme une erreur ni
    // être rejouable (wasScenarioSent bloque tout nouvel essai).
    if (!result.ok) throw new Error(result.error || 'Échec envoi Brevo');
    const { error: upsertErr } = await supabase.from('email_sent')
      .upsert({ reservation_id: reservationId, scenario, sent_at: new Date().toISOString() }, { onConflict: 'reservation_id,scenario' });
    if (upsertErr) throw new Error(`email_sent upsert failed: ${upsertErr.message}`);
    supabase.from('email_log').insert({
      reservation_id: reservationId, scenario, destinataire: reservation.email, modele: scenario, statut: 'envoye',
      contenu: html,
    }).catch(() => {});
    return { sent: true };
  } catch (e) {
    await supabase.from('email_log').insert({
      reservation_id: reservationId, scenario, destinataire: reservation.email, modele: scenario,
      statut: 'erreur', erreur: String(e.message || e).slice(0, 500), contenu: html,
    });
    return { sent: false, reason: 'error', error: e.message };
  }
}

module.exports = { SCENARIOS, sendScenarioEmail, buildEmailContext, getSignature, signatureFooterHtml, withSignature, wasScenarioSent, wasScenarioSkipped, isScenarioActive, fmtDate, fmtDateFR };
