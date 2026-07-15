const crypto = require('crypto');
const { generateContratPdf, generateFacturePdf } = require('./pdf');
const { sendBrevoEmail } = require('./brevo');
const { CGV_VERSION } = require('./legal');

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

function contratHtml({ prenom, ref, viewUrlContrat, viewUrlFacture }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;color:#333;max-width:560px;margin:0 auto">
    <h2 style="color:#1b3a5f">Vos documents Loc'Air — Dossier ${ref}</h2>
    <p>Bonjour ${prenom || ''},</p>
    <p>Voici votre contrat de location et votre facture, en pièces jointes de cet email (PDF).</p>
    <p style="margin:20px 0"><a href="${viewUrlContrat}" style="color:#1b3a5f">Consulter le contrat en ligne</a><br/>
    <a href="${viewUrlFacture}" style="color:#1b3a5f">Consulter la facture en ligne</a></p>
    <p style="font-size:12px;color:#888">Conservez cet email — ces documents restent consultables via les liens ci-dessus.</p>
  </body></html>`;
}

// Point d'entrée appelé une seule fois, juste après confirmation du paiement
// Stripe pour une réservation standard (jamais pour une prolongation, jamais
// à l'installation) — voir api/webhook.js. Idempotent : si une facture existe
// déjà pour cette réservation, ne régénère ni ne renvoie rien (protège contre
// une redélivrance du webhook Stripe).
//
// Verrou volontaire : la mise en page du contrat/facture (_lib/pdf.js) est
// encore le modèle générique par défaut, en attente des modèles réels
// (Contrat de location Loc'Air / Facture Loc'Air) à fournir par le
// propriétaire. Tant que DOCUMENTS_ENABLED n'est pas explicitement à 'true'
// dans les variables d'environnement Vercel, cette fonction ne fait rien —
// aucun document n'est généré ni envoyé, même si le code est en prod.
async function generateAndSendDocuments(supabase, resa) {
  if (process.env.DOCUMENTS_ENABLED !== 'true') return;
  if (!resa || !resa.id) return;

  const { data: existingFacture } = await supabase
    .from('documents').select('id').eq('reservation_id', resa.id).eq('type', 'facture').maybeSingle();
  if (existingFacture) return; // déjà généré — ne jamais dupliquer la facture

  const [{ data: reservAppareils }, { data: acceptations }] = await Promise.all([
    supabase.from('reservation_appareils').select('appareil:appareils(numero)').eq('reservation_id', resa.id),
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

  const factureBuffer = await generateFacturePdf({ reservation: resa, numero, datePaiement: now });
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
    const contratEmailHtml = contratHtml({
      prenom: resa.prenom,
      ref:    resa.ref,
      viewUrlContrat: `${base}/api/document-view?token=${contratToken}`,
      viewUrlFacture: `${base}/api/document-view?token=${factureToken}`,
    });
    await sendBrevoEmail({
      to:      resa.email,
      subject: `📄 Votre contrat et votre facture Loc'Air — Dossier ${resa.ref}`,
      html:    contratEmailHtml,
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

module.exports = { generateAndSendDocuments };
