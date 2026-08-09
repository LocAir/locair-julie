const crypto = require('crypto');
const { generateContratPdf, generateFacturePdf, generateFactureVentePdf, generateAvenantProlongationPdf } = require('./pdf');
const { sendBrevoEmail } = require('./brevo');
const { CGV_VERSION } = require('./legal');
const { getPricingConfig } = require('./pricing');
const { getForfaitById } = require('./forfaits');
const { tplContratFacture, tplContratFactureProlongation, tplFactureVente } = require('./emailTemplates');
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

  const { data: existingFacture, error: existingErr } = await supabase
    .from('documents').select('id').eq('reservation_id', resa.id).eq('type', 'facture').maybeSingle();
  if (existingErr) console.error('[Documents] vérif facture existante:', existingErr.message);
  if (existingFacture) return; // déjà généré — ne jamais dupliquer la facture

  const [{ data: reservAppareils }, { data: acceptations }] = await Promise.all([
    supabase.from('reservation_appareils').select('appareil:appareils(numero, modele:modeles_climatiseur(marque, modele))').eq('reservation_id', resa.id),
    supabase.from('cgv_acceptations').select('type, version, accepted_at').eq('reservation_id', resa.id),
  ]);
  const appareils = (reservAppareils || []).map(r => r.appareil).filter(Boolean);

  const now = new Date();
  const annee = now.getUTCFullYear();
  // Tarifs (panneau de contrôle admin, voir admin-pricing.js) — jamais
  // recalculés en dur dans le contrat/la facture.
  const pricing = await getPricingConfig(supabase);
  // Pack à prix fixe (ex. "Pack Sérénité") le cas échéant — sans ça, le
  // contrat/la facture décriraient à tort le barème dégressif normal pour
  // une location qui n'a jamais suivi ce calcul (voir _lib/pdf.js).
  const forfait = await getForfaitById(supabase, resa.forfait_id);

  // ── Contrat ─────────────────────────────────────────────────────────────
  const contratBuffer = await generateContratPdf({ reservation: resa, appareils, acceptations, version: CGV_VERSION, pricing, forfait });
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

  const factureBuffer = await generateFacturePdf({ reservation: resa, appareils, numero, datePaiement: now, pricing, forfait });
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
      ? `Your Loc'Air documents — Ref ${resa.ref}`
      : lang === 'zh'
      ? `您的 Loc'Air 文件 — 订单 ${resa.ref}`
      : `Votre contrat et votre facture Loc'Air — Dossier ${resa.ref}`;
    // Décalé de 4 min par rapport au mail de confirmation envoyé juste après
    // (voir webhook.js) — évite que les deux tombent à la même minute dans
    // la boîte du client.
    const result = await sendBrevoEmail({
      to:      resa.email,
      subject: contratSubject,
      html:    contratEmailHtml,
      senderName: sig.nom_expediteur,
      scheduledAt: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
      attachments: [
        { name: `Contrat-${resa.ref}.pdf`, content: contratBuffer },
        { name: `${numero}.pdf`, content: factureBuffer },
      ],
    });

    // Ne marquer 'envoye' que si l'email est réellement parti (sendBrevoEmail
    // ne jette jamais, voir _lib/brevo.js) — sans quoi un échec Brevo laissait
    // croire que le document avait été transmis alors qu'aucun mail n'était
    // réellement délivré. Documents et contrat déjà générés et consultables
    // par l'admin dans tous les cas, seul le statut d'envoi change.
    if (result.ok) {
      const sentAt = new Date().toISOString();
      await supabase.from('documents').update({ statut: 'envoye', envoye_at: sentAt }).eq('id', contratRow.id);
      await supabase.from('documents').update({ statut: 'envoye', envoye_at: sentAt })
        .eq('reservation_id', resa.id).eq('type', 'facture');
    } else {
      console.error('[Documents] envoi email échoué —', result.error);
    }
    // Best-effort : trace pour l'historique de la fiche client admin. Le
    // contenu stocké est le corps de l'email (pas les PDF joints, non
    // affichables dans l'aperçu). Statut fidèle au résultat réel de l'envoi
    // (voir plus haut) — jamais "envoye" à tort en cas d'échec Brevo.
    supabase.from('email_log').insert({
      reservation_id: resa.id, scenario: 'email_contrat_facture', canal: 'email',
      destinataire: resa.email, modele: 'email_contrat_facture',
      statut: result.ok ? 'envoye' : 'erreur',
      erreur: result.ok ? null : String(result.error || '').slice(0, 500),
      contenu: contratEmailHtml,
    }).then(() => {}, () => {});
  }
}

// Point d'entrée appelé après une prolongation payée (voir api/webhook.js,
// api/admin-reservations.js) — corrige un vrai trou trouvé lors de l'audit du
// 2026-07-27 : generateAndSendDocuments ci-dessus n'est jamais appelée pour
// une prolongation, donc le client ne recevait plus jamais de document
// contractuel reflétant sa vraie date de fin ni le montant réellement payé
// après extension.
//
// Générait au départ un contrat ENTIER réédité à chaque prolongation — corrigé
// (demande explicite du 2026-08-09) au profit d'un avenant, la pratique
// standard pour amender un contrat déjà signé sans le réémettre en entier :
// un document court qui dit précisément ce qui change (nouvelle date de fin,
// montant payé), le contrat d'origine reste la seule référence pour tout le
// reste (voir generateAvenantProlongationPdf, _lib/pdf.js).
//
// `origineResa` : la réservation d'ORIGINE (jamais 'site_prolongation'), avec
// son date_fin déjà mis à jour par l'appelant AVANT ce call — c'est son
// contrat que l'avenant amende.
// `prolongationResa` : la réservation de prolongation elle-même (source
// 'site_prolongation'), qui porte le paiement de l'extension — c'est elle qui
// reçoit sa propre facture (montant de l'extension seule, jamais cumulé avec
// la réservation d'origine) et dont les dates servent à l'avenant (date_debut
// = ancienne date de fin, date_fin = nouvelle date de fin).
//
// Pas de garde d'idempotence sur l'avenant : plusieurs prolongations
// successives du même dossier créent chacune leur propre avenant numéroté
// (1, 2, 3...), tous consultables par l'admin — jamais de doublon puisque
// chaque webhook Stripe de prolongation ne peut correspondre qu'à une seule
// prolongationResa, jamais rejouée deux fois pour la même. La facture de
// prolongation, elle, reste protégée par l'unicité habituelle puisqu'elle est
// posée sur reservation_id = prolongationResa.id, qui n'en a encore jamais eu.
async function generateAndSendDocumentsAfterProlongation(supabase, { origineResa, prolongationResa }) {
  if (process.env.DOCUMENTS_ENABLED !== 'true') return;
  if (!origineResa || !origineResa.id || !prolongationResa || !prolongationResa.id) return;

  const [{ data: reservAppareils }, { data: avenantsExistants }] = await Promise.all([
    supabase.from('reservation_appareils').select('appareil:appareils(numero, modele:modeles_climatiseur(marque, modele))').eq('reservation_id', origineResa.id),
    supabase.from('documents').select('id').eq('reservation_id', origineResa.id).eq('type', 'avenant'),
  ]);
  const appareils = (reservAppareils || []).map(r => r.appareil).filter(Boolean);
  const avenantNumero = (avenantsExistants || []).length + 1;

  const now = new Date();
  const annee = now.getUTCFullYear();
  // Tarifs (panneau de contrôle admin, voir admin-pricing.js) — jamais
  // recalculés en dur dans l'avenant/la facture.
  const pricing = await getPricingConfig(supabase);

  // ── Avenant de prolongation (amende le contrat d'origine, cf. commentaire
  //    ci-dessus) ────────────────────────────────────────────────────────
  const avenantBuffer = await generateAvenantProlongationPdf({ origineResa, prolongationResa, appareils, avenantNumero });
  const avenantPath = `documents/avenants/${origineResa.ref}-${now.getTime()}.pdf`;
  await uploadPdf(supabase, avenantPath, avenantBuffer);
  const avenantToken = accessToken();
  const { data: avenantRow, error: avenantErr } = await supabase.from('documents').insert({
    reservation_id: origineResa.id,
    type:           'avenant',
    numero:         `AVENANT-${origineResa.ref}-${avenantNumero}`,
    version:        CGV_VERSION,
    storage_path:   avenantPath,
    access_token:   avenantToken,
    montant_ttc_cents: prolongationResa.prix_total_cents || 0,
    statut:         'genere',
    genere_at:      now.toISOString(),
  }).select('id').single();
  if (avenantErr) throw avenantErr;

  // ── Facture de la prolongation (montant de l'extension uniquement) ───────
  const { data: numeroSeq, error: numeroErr } = await supabase.rpc('next_invoice_number', { p_annee: annee });
  if (numeroErr) throw numeroErr;
  const numero = invoiceNumber(annee, numeroSeq);

  const factureBuffer = await generateFacturePdf({ reservation: prolongationResa, appareils, numero, datePaiement: now, pricing });
  const facturePath = `documents/factures/${numero}.pdf`;
  await uploadPdf(supabase, facturePath, factureBuffer);
  const factureToken = accessToken();
  const { data: factureRow, error: factureErr } = await supabase.from('documents').insert({
    reservation_id: prolongationResa.id,
    type:           'facture',
    numero,
    version:        CGV_VERSION,
    storage_path:   facturePath,
    access_token:   factureToken,
    montant_ttc_cents: prolongationResa.prix_total_cents || 0,
    statut:         'genere',
    genere_at:      now.toISOString(),
  }).select('id').single();
  if (factureErr) throw factureErr;

  // ── Envoi email (avenant + facture de prolongation) ───────────────────────
  // Email envoyé EN PLUS de sendProlongationConfirmation (jamais à la place) —
  // celui-ci ne fournit qu'une confirmation informelle, pas de document
  // contractuel en pièce jointe.
  if (origineResa.email) {
    const base = 'https://www.locair.fr';
    const sig = await getSignature(supabase);
    const lang = origineResa.lang || prolongationResa.lang || 'fr';
    const html = withSignature(tplContratFactureProlongation({
      prenom: origineResa.prenom,
      ref:    origineResa.ref,
      lang,
      viewUrlDocuments: `${base}/api/documents-view?avenant=${avenantToken}&facture=${factureToken}`,
    }), sig);
    const subject = lang === 'en'
      ? `Your prolongation amendment — Ref ${origineResa.ref}`
      : lang === 'zh'
      ? `您的续租合同附加协议 — 订单 ${origineResa.ref}`
      : `Votre avenant de prolongation et votre facture — Dossier ${origineResa.ref}`;
    // Décalé de 4 min par rapport au mail de confirmation de prolongation
    // (sendProlongationConfirmation) envoyé au même moment — voir commentaire
    // équivalent sur generateAndSendDocuments ci-dessus.
    const result = await sendBrevoEmail({
      to:      origineResa.email,
      subject,
      html,
      senderName: sig.nom_expediteur,
      scheduledAt: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
      attachments: [
        { name: `Avenant-${avenantNumero}-${origineResa.ref}.pdf`, content: avenantBuffer },
        { name: `${numero}.pdf`, content: factureBuffer },
      ],
    });

    if (result.ok) {
      const sentAt = new Date().toISOString();
      await supabase.from('documents').update({ statut: 'envoye', envoye_at: sentAt }).eq('id', avenantRow.id);
      await supabase.from('documents').update({ statut: 'envoye', envoye_at: sentAt }).eq('id', factureRow.id);
    } else {
      console.error('[Documents prolongation] envoi email échoué —', result.error);
    }
    supabase.from('email_log').insert({
      reservation_id: prolongationResa.id, scenario: 'email_avenant_facture_prolongation', canal: 'email',
      destinataire: origineResa.email, modele: 'email_avenant_facture_prolongation',
      statut: result.ok ? 'envoye' : 'erreur',
      erreur: result.ok ? null : String(result.error || '').slice(0, 500),
      contenu: html,
    }).then(() => {}, () => {});
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
      dateAchatFmt: now.toLocaleDateString(lang === 'zh' ? 'zh-CN' : lang === 'en' ? 'en-GB' : 'fr-FR'),
      montantFmt: (prixCents / 100).toFixed(2).replace('.', ',') + ' €',
      viewUrlFacture: `${base}/api/document-view?token=${factureToken}`,
    }), sig);
    const ventSubject = lang === 'en'
      ? `Your Loc'Air purchase invoice — Ref ${resa.ref}`
      : lang === 'zh'
      ? `您的 Loc'Air 购买发票 — 订单 ${resa.ref}`
      : `Votre facture d'achat Loc'Air — Dossier ${resa.ref}`;
    const result = await sendBrevoEmail({
      to:      resa.email,
      subject: ventSubject,
      html,
      senderName: sig.nom_expediteur,
      attachments: [{ name: `${numero}.pdf`, content: factureBuffer }],
    });
    if (result.ok) {
      await supabase.from('documents').update({ statut: 'envoye', envoye_at: new Date().toISOString() })
        .eq('reservation_id', resa.id).eq('type', 'facture_vente');
      supabase.from('email_log').insert({
        reservation_id: resa.id, scenario: 'email_facture_vente', canal: 'email',
        destinataire: resa.email, modele: 'email_facture_vente', statut: 'envoye', contenu: html,
      }).then(() => {}, () => {});
    } else {
      console.error('[Documents] envoi facture de vente échoué —', result.error);
      supabase.from('email_log').insert({
        reservation_id: resa.id, scenario: 'email_facture_vente', canal: 'email',
        destinataire: resa.email, modele: 'email_facture_vente', statut: 'erreur',
        erreur: String(result.error || '').slice(0, 500), contenu: html,
      }).then(() => {}, () => {});
    }
  }
}

module.exports = { generateAndSendDocuments, generateAndSendDocumentsAfterProlongation, generateAndSendFactureVente };
