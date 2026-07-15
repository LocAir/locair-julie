const PDFDocument = require('pdfkit');
const { SELLER } = require('./legal');

// Génère un PDF en mémoire (pas de fichier temporaire — la fonction serverless
// n'a pas de disque persistant garanti) et résout un Buffer une fois le
// document terminé. `draw(doc)` reçoit l'instance PDFKit et dessine le contenu.
function renderPdf(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      draw(doc);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function fmtDate(d) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtDateHeure(d) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function eur(cents) {
  return (Math.round(cents || 0) / 100).toFixed(2).replace('.', ',') + ' €';
}

function drawHeader(doc, title) {
  doc.fontSize(18).fillColor('#1b3a5f').text(SELLER.nomCommercial, { continued: false });
  doc.fontSize(9).fillColor('#666')
    .text(`${SELLER.raisonSociale} — ${SELLER.formeJuridique}`)
    .text(`${SELLER.adresse}`)
    .text(`SIRET ${SELLER.siret} · ${SELLER.tel} · ${SELLER.email}`);
  doc.moveDown(1);
  doc.fontSize(15).fillColor('#111').text(title);
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').stroke();
  doc.moveDown(0.8);
}

function drawKeyValueRow(doc, label, value) {
  const y = doc.y;
  doc.fontSize(10).fillColor('#666').text(label, 50, y, { width: 160 });
  doc.fontSize(10).fillColor('#111').text(String(value ?? '—'), 220, y, { width: 325 });
  doc.moveDown(0.35);
}

function drawSectionTitle(doc, text) {
  doc.moveDown(0.6);
  doc.fontSize(11).fillColor('#1b3a5f').text(text);
  doc.moveDown(0.2);
}

// ── Contrat de location ────────────────────────────────────────────────────
// Contenu exigé : identité + coordonnées client, numéro de commande, dates de
// location, climatiseur associé si disponible, montant, conditions
// acceptées + horodatage + version des documents acceptés à l'acceptation.
function generateContratPdf({ reservation, appareils, acceptations, version }) {
  return renderPdf((doc) => {
    drawHeader(doc, `Contrat de location — Dossier ${reservation.ref}`);

    drawSectionTitle(doc, 'Client');
    drawKeyValueRow(doc, 'Nom', `${reservation.prenom || ''} ${reservation.nom || ''}`.trim());
    drawKeyValueRow(doc, 'Adresse de livraison', reservation.adresse || '—');
    drawKeyValueRow(doc, 'Téléphone', reservation.tel || '—');
    drawKeyValueRow(doc, 'Email', reservation.email || '—');
    if (reservation.type_client === 'entreprise') {
      drawKeyValueRow(doc, 'Raison sociale', reservation.raison_sociale || '—');
      drawKeyValueRow(doc, 'SIRET client', reservation.siret || '—');
    }

    drawSectionTitle(doc, 'Location');
    drawKeyValueRow(doc, 'Numéro de commande', reservation.ref);
    drawKeyValueRow(doc, 'Début de location', fmtDate(reservation.date_debut));
    drawKeyValueRow(doc, 'Fin de location', fmtDate(reservation.date_fin));
    drawKeyValueRow(doc, 'Quantité', `${reservation.quantite} climatiseur${reservation.quantite > 1 ? 's' : ''}`);
    drawKeyValueRow(doc, 'Climatiseur(s) associé(s)',
      appareils && appareils.length ? appareils.map(a => `Unité n°${a.numero}`).join(', ') : 'Attribué à la livraison');
    drawKeyValueRow(doc, 'Montant de la location', eur(reservation.prix_total_cents));

    drawSectionTitle(doc, 'Conditions acceptées électroniquement');
    if (acceptations && acceptations.length) {
      for (const a of acceptations) {
        const label = a.type === 'cgv_location'
          ? "Conditions générales de vente et de location (CGV/CGL)"
          : "Conditions d'utilisation du climatiseur et obligations liées à la location";
        drawKeyValueRow(doc, label, `Acceptées le ${fmtDateHeure(a.accepted_at)} — version ${a.version}`);
      }
    } else {
      drawKeyValueRow(doc, 'Acceptation CGV/CGL', `Le ${fmtDateHeure(reservation.cgv_accepted_at)} — version ${version}`);
    }

    doc.moveDown(1.2);
    doc.fontSize(8).fillColor('#888').text(
      "Ce contrat est généré et accepté électroniquement au moment du paiement — aucune signature manuscrite n'est requise. " +
      "Les conditions générales complètes (CGV/CGL) sont consultables à tout moment sur locair.fr/cgv.",
      { width: 495 }
    );
  });
}

// ── Facture ─────────────────────────────────────────────────────────────────
// Contenu exigé : numéro de facture, numéro de commande, identité client,
// montant payé, date de paiement, mentions légales obligatoires.
function generateFacturePdf({ reservation, numero, datePaiement }) {
  return renderPdf((doc) => {
    drawHeader(doc, `Facture ${numero}`);

    drawSectionTitle(doc, 'Client');
    drawKeyValueRow(doc, 'Nom', `${reservation.prenom || ''} ${reservation.nom || ''}`.trim());
    if (reservation.type_client === 'entreprise' && reservation.raison_sociale) {
      drawKeyValueRow(doc, 'Raison sociale', reservation.raison_sociale);
      drawKeyValueRow(doc, 'SIRET client', reservation.siret || '—');
    }
    drawKeyValueRow(doc, 'Adresse', reservation.adresse || '—');
    drawKeyValueRow(doc, 'Email', reservation.email || '—');

    drawSectionTitle(doc, 'Détail');
    drawKeyValueRow(doc, 'Numéro de facture', numero);
    drawKeyValueRow(doc, 'Numéro de commande', reservation.ref);
    drawKeyValueRow(doc, 'Date de paiement', fmtDate(datePaiement));
    drawKeyValueRow(doc, 'Désignation',
      `Location climatiseur mobile — ${fmtDate(reservation.date_debut)} au ${fmtDate(reservation.date_fin)}`);
    drawKeyValueRow(doc, 'Quantité', `${reservation.quantite} climatiseur${reservation.quantite > 1 ? 's' : ''}`);

    doc.moveDown(0.4);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').stroke();
    doc.moveDown(0.4);
    doc.fontSize(12).fillColor('#111').text(`Montant payé (TTC) : ${eur(reservation.prix_total_cents)}`, { align: 'right' });
    doc.fontSize(9).fillColor('#666').text(SELLER.mentionTva, { align: 'right' });

    doc.moveDown(1.2);
    doc.fontSize(8).fillColor('#888').text(
      `${SELLER.raisonSociale} (${SELLER.nomCommercial}) · ${SELLER.formeJuridique} · SIRET ${SELLER.siret} · ${SELLER.adresse}. ` +
      'Facture émise conformément aux articles L441-9 et suivants du Code de commerce. Aucun escompte pour paiement anticipé. ' +
      "Pénalités de retard : sans objet (paiement comptant préalable à la prestation).",
      { width: 495 }
    );
  });
}

module.exports = { generateContratPdf, generateFacturePdf };
