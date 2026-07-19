const crypto = require('crypto');
const { generateContratPdf, generateFacturePdf, generateFactureVentePdf } = require('./pdf');
const { sendBrevoEmail } = require('./brevo');
const { CGV_VERSION } = require('./legal');
const { tplContratFacture, tplFactureVente } = require('./emailTemplates');
const { getSignature, withSignature } = require('./emailEngine');

function accessToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function uploadPdf(supabase, path, buffer) {
  const { error } = await supabase.storage.from('missions').upload(path, buffer, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (error) throw error;
}

function invoiceNumber(annee, n) {
  return `FACT-${annee}-${String(n).padStart(6, '0')}`;
}

// Point d'entrée appelé une seule fois, juste après confirmation du paiement
// Stripe pour une réservation standard (jamais pour une prolongation, jamais
// à l'installation) — voir api/webhook.js. Idempotent : si une facture existe
// déjà pour cette réservation, ne régénère ni ne renvoie rien (protège contre
// une redélivrance du webhook Stripe).
//
// Verrou volontaire : tant que DOCUMENTS_ENABLED n'est pas explicitement à
// 'true' dans les variables d'environnement Vercel, cette fonction ne fait
// rien — aucun document n'est généré ni envoyé, même si le code est en prod.
// (Les modèles réels du contrat et de la facture, fournis par le
// propriétaire, sont en place dans _lib/pdf.js depuis le 2026-07-16 — ce
// verrou ne sert plus qu'à activer l'envoi le jour choisi.)
// { force: true } contourne ce verrou — utilisé uniquement par le bouton
// "Générer les documents" de la fiche client admin (admin-clients.js),
// jamais par le webhook Stripe automatique.
async function generateAndSendDocuments(supabase, resa, { force } = {}) {
  if (!force && process.env.DOCUMENTS_ENABLED !== 'true') return;
  if (!resa || !resa.id) return;

  const { data: existingFacture } = await supabase
    .from('documents').select('id').eq('reservation_id', resa.id).eq('type', 'facture').maybeSingle();
  if (existingFacture) return; // déjà généré — ne jamais dupliquer la facture

  const [{ data: reservAppareils }, { data: acceptations }] = await Promise.all([
    supabase.from('reservation_appareils').select('appareil:appareils(numero, modele:modeles_climatiseur(marque, modele))').eq('reservation_id', resa.id),
    supabase.from('cgv_acceptations').select('type, version, accepted_at').eq('reservation_id', resa.id),
  ]);
  const appareils = (reservAppareils || []).map(r => r.appareil).filter(Boolean);

  const now = new Date();
  const annee = now.getUTCFullYear();

  // ── Contrat ─────────────────────────────────────────────────────────────
  const contratBuffer = await generateContratPdf({ reservation: resa, appareils, acceptations, version: CGV_VERSION });
  const contratPath = `documents/contrats/${resa.ref}-${now.getTime()}.pdf`;
  await uploadPdf(supabase, contratPath, contratBuffer);
  const contratToken = accessToken();
  const { data: contratRow, error: contratErr } = await supabase.from('documents').insert({
    reservation_id: resa.id,
    type:           'contrat',
    version:        CGV_VERSION,
    storage_path:   contratPath,
    access_token:   contratToken,
    montant_ttc_cents: resa.prix_total_cents || 0,
    statut:         'genere',
    genere_at:      now.toISOString(),
  }).select('id').single();
  if (contratErr) throw contratErr;

  // ── Facture (numérotation séquentielle par année, verrouillée côté SQL) ──
  const { data: numeroSeq, error: numeroErr } = await supabase.rpc('next_invoice_number', { p_annee: annee });
  if (numeroErr) throw numeroErr;
  const numero = invoiceNumber(annee, numeroSeq);

  const factureBuffer = await generateFacturePdf({ reservation: resa, appareils, numero, datePaiement: now });
  const facturePath = `documents/factures/${numero}.pdf`;
  await uploadPdf(supabase, facturePath, factureBuffer);
  const factureToken = accessToken();
  const { error: factureErr } = await supabase.from('documents').insert({
    reservation_id: resa.id,
    type:           'facture',
    numero,
    version:        CGV_VERSION,
    storage_path:   facturePath,
    access_token:   factureToken,
    montant_ttc_cents: resa.prix_total_cents || 0,
    statut:         'genere',
    genere_at:      now.toISOString(),
  });
  if (factureErr) throw factureErr;

  // ── Envoi email (une seule fois, les deux documents en pièce jointe) ─────
  // Statut reste 'genere' (jamais 'envoye') si le client n'a pas d'email —
  // les documents restent générés et consultables par l'admin dans ce cas.
  if (resa.email) {
    const base = 'https://www.locair.fr';
    const sig = await getSignature(supabase);
    const lang = resa.lang || 'fr';
    const contratEmailHtml = withSignature(tplContratFacture({
      prenom: resa.prenom,
      ref:    resa.ref,
      lang,
      viewUrlDocuments: `${base}/api/documents-view?contrat=${contratToken}&facture=${factureToken}`,
    }), sig);
    const contratSubject = lang === 'en'
      ? `📄 Your Loc'Air documents — Ref ${resa.ref}`
      : lang === 'zh'
      ? `📄 您的 Loc'Air 文件 — 订单 ${resa.ref}`
      : `📄 Votre contrat et votre facture Loc'Air — Dossier ${resa.ref}`;
    await sendBrevoEmail({
      to:      resa.email,
      subject: contratSubject,
      html:    contratEmailHtml,
      senderName: sig.nom_expediteur,
      attachments: [
        { name: `Contrat-${resa.ref}.pdf`, content: contratBuffer },
        { name: `${numero}.pdf`, content: factureBuffer },
      ],
    });

    const sentAt = new Date().toISOString();
    await supabase.from('documents').update({ statut: 'envoye', envoye_at: sentAt }).eq('id', contratRow.id);
    await supabase.from('documents').update({ statut: 'envoye', envoye_at: sentAt })
      .eq('reservation_id', resa.id).eq('type', 'facture');
    // Best-effort : trace pour l'historique de la fiche client admin. Le
    // contenu stocké est le corps de l'email (pas les PDF joints, non
    // affichables dans l'aperçu).
    supabase.from('email_log').insert({
      reservation_id: resa.id, scenario: 'email_contrat_facture', canal: 'email',
      destinataire: resa.email, modele: 'email_contrat_facture', statut: 'envoye', contenu: contratEmailHtml,
    }).catch(() => {});
  }
}

// Point d'entrée appelé une seule fois, juste après acceptation d'une Offre
// Privilège (voir handleOffrePrivilegeAccepted dans api/webhook.js) — jamais
// pour une location classique (voir generateAndSendDocuments ci-dessus).
// Réutilise la même numérotation séquentielle FACT-YYYY-NNNNNN que les
// factures de location (obligation légale de continuité de la série), mais
// un type de document distinct ("facture_vente") pour ne jamais entrer en
// conflit avec la facture de location déjà existante sur cette réservation.
//
// Même verrou que les autres documents : tant que DOCUMENTS_ENABLED n'est pas
// explicitement à 'true', cette fonction ne fait rien.
async function generateAndSendFactureVente(supabase, { reservationId, appareilId, prixCents, force }) {
  if (!force && process.env.DOCUMENTS_ENABLED !== 'true') return;
  if (!reservationId || !appareilId || !prixCents) return;

  const { data: existante } = await supabase
    .from('documents').select('id').eq('reservation_id', reservationId).eq('type', 'facture_vente').maybeSingle();
  if (existante) return; // déjà générée — jamais de doublon

  const [{ data: resa }, { data: appareil }] = await Promise.all([
    supabase.from('reservations').select('*').eq('id', reservationId).maybeSingle(),
    supabase.from('appareils').select('numero, modele:modeles_climatiseur(marque, modele)').eq('id', appareilId).maybeSingle(),
  ]);
  if (!resa) return;

  const now = new Date();
  const annee = now.getUTCFullYear();
  const { data: numeroSeq, error: numeroErr } = await supabase.rpc('next_invoice_number', { p_annee: annee });
  if (numeroErr) throw numeroErr;
  const numero = invoiceNumber(annee, numeroSeq);

  const factureBuffer = await generateFactureVentePdf({ reservation: resa, appareil, numero, montantCents: prixCents, datePaiement: now });
  const facturePath = `documents/factures/${numero}.pdf`;
  await uploadPdf(supabase, facturePath, factureBuffer);
  const factureToken = accessToken();
  const { error: factureErr } = await supabase.from('documents').insert({
    reservation_id: reservationId,
    type:           'facture_vente',
    numero,
    version:        CGV_VERSION,
    storage_path:   facturePath,
    access_token:   factureToken,
    montant_ttc_cents: prixCents,
    statut:         'genere',
    genere_at:      now.toISOString(),
  });
  if (factureErr) throw factureErr;

  if (resa.email) {
    const base = 'https://www.locair.fr';
    const sig = await getSignature(supabase);
    const lang = resa.lang || 'fr';
    const modeleClimatiseur = appareil && appareil.modele ? `${appareil.modele.marque} ${appareil.modele.modele}` : '';
    const html = withSignature(tplFactureVente({
      prenom: resa.prenom,
      ref:    resa.ref,
      lang,
      modeleClimatiseur,
      dateAchatFmt: now.toLocaleDateString('fr-FR'),
      montantFmt: (prixCents / 100).toFixed(2).replace('.', ',') + ' €',
      viewUrlFacture: `${base}/api/document-view?token=${factureToken}`,
    }), sig);
    const ventSubject = lang === 'en'
      ? `📄 Your Loc'Air purchase invoice — Ref ${resa.ref}`
      : lang === 'zh'
      ? `📄 您的 Loc'Air 购买发票 — 订单 ${resa.ref}`
      : `📄 Votre facture d'achat Loc'Air — Dossier ${resa.ref}`;
    await sendBrevoEmail({
      to:      resa.email,
      subject: ventSubject,
      html,
      senderName: sig.nom_expediteur,
      attachments: [{ name: `${numero}.pdf`, content: factureBuffer }],
    });
    await supabase.from('documents').update({ statut: 'envoye', envoye_at: new Date().toISOString() })
      .eq('reservation_id', resa.id).eq('type', 'facture_vente');
    supabase.from('email_log').insert({
      reservation_id: resa.id, scenario: 'email_facture_vente', canal: 'email',
      destinataire: resa.email, modele: 'email_facture_vente', statut: 'envoye', contenu: html,
    }).catch(() => {});
  }
}

module.exports = { generateAndSendDocuments, generateAndSendFactureVente };
