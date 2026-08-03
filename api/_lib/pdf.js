const PDFDocument = require('pdfkit');
const { SELLER } = require('./legal');
const { calcTieredPrice } = require('./pricing');

// Palette
const C = {
  navy:  '#1a2b4a',
  body:  '#1a1a1a',
  grey:  '#555555',
  lgrey: '#888888',
  rule:  '#c8c8c8',
  ruleL: '#e4e4e4',
  bg:    '#f4f6f9',
  bgD:   '#e8ecf2',
  white: '#ffffff',
  // Texte sur fond navy
  wSec:  '#b8cce0',  // secondaire blanc
  wTer:  '#8899b4',  // tertiaire blanc
};

// Mise en page A4
const M  = 50;       // marge gauche/droite/haut/bas
const PW = 595.28;   // largeur page
const PH = 841.89;   // hauteur page
const W  = PW - 2*M; // largeur utile = 495.28

function renderPdf(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try { draw(doc); doc.end(); } catch (e) { reject(e); }
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

function nbJours(dateDebut, dateFin) {
  const d1 = new Date(dateDebut + 'T00:00:00Z');
  const d2 = new Date(dateFin   + 'T00:00:00Z');
  return Math.max(1, Math.round((d2 - d1) / 86400000));
}

function modeleLabel(appareils) {
  const a = appareils && appareils[0];
  if (a && a.modele) {
    const m = a.modele;
    return `${m.marque || ''} ${m.modele || ''}`.trim() || 'Climatiseur mobile';
  }
  return 'Rowenta RWAC10KA ou FRICO CLIMOB 12 (9 000 à 12 000 BTU)';
}

// ─── Primitives graphiques ────────────────────────────────────────────────────

function hLine(doc, x, y, w, color, lw) {
  doc.moveTo(x, y).lineTo(x + w, y).strokeColor(color || C.rule).lineWidth(lw || 0.5).stroke();
}

function filledRect(doc, x, y, w, h, fill, r) {
  if (r) doc.roundedRect(x, y, w, h, r); else doc.rect(x, y, w, h);
  doc.fill(fill);
}

// ─── En-tête CONTRAT : bandeau navy plein-bord ────────────────────────────────
function drawContratHeader(doc, ref) {
  const BH = 76; // hauteur bandeau
  filledRect(doc, 0, 0, PW, BH, C.navy);

  // Gauche — entreprise
  doc.font('Helvetica-Bold').fontSize(19).fillColor(C.white)
    .text(SELLER.nomCommercial, M, 12, { width: 260, lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor(C.wSec)
    .text(SELLER.formeJuridique, M, 36, { width: 270 })
    .text(SELLER.adresse,        M, 47, { width: 270 })
    .text(`SIRET ${SELLER.siret} · ${SELLER.tel} · ${SELLER.email}`, M, 58, { width: 280 });

  // Droite — titre document
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.white)
    .text('CONTRAT DE LOCATION', 310, 16, { width: 235, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(C.wSec)
    .text('Climatiseur mobile', 310, 32, { width: 235, align: 'right' });
  if (ref) {
    doc.font('Helvetica').fontSize(8).fillColor(C.wTer)
      .text(`Dossier n° ${ref}`, 310, 52, { width: 235, align: 'right' });
  }

  doc.x = M;
  doc.y = BH + 12;
}

// ─── En-tête FACTURE : émetteur gauche · boîte infos droite ──────────────────
function drawFactureHeader(doc, numero, datePaiement, ref, titre) {
  const topY  = M;          // 50
  const colW  = 245;
  const boxW  = 205;
  const boxX  = PW - M - boxW;
  const boxH  = 80;

  // Colonne gauche — émetteur
  doc.font('Helvetica-Bold').fontSize(17).fillColor(C.navy)
    .text(SELLER.nomCommercial, M, topY, { width: colW });
  doc.font('Helvetica').fontSize(8.5).fillColor(C.grey)
    .text(SELLER.formeJuridique,                              M, topY + 23, { width: colW })
    .text(SELLER.adresse,                                     M, topY + 34, { width: colW })
    .text(`SIRET ${SELLER.siret}`,                       M, topY + 45, { width: colW })
    .text(`${SELLER.tel} · ${SELLER.email}`,   M, topY + 56, { width: colW });

  // Colonne droite — boîte infos document
  filledRect(doc, boxX, topY - 4, boxW, boxH, C.bg, 6);
  doc.font('Helvetica-Bold').fontSize(15).fillColor(C.navy)
    .text(titre || 'FACTURE', boxX + 14, topY + 5, { width: boxW - 28 });
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.body)
    .text(numero, boxX + 14, topY + 24, { width: boxW - 28 });
  doc.font('Helvetica').fontSize(8.5).fillColor(C.grey)
    .text(`Émise le ${fmtDate(datePaiement)}`, boxX + 14, topY + 38, { width: boxW - 28 })
    .text('Réglée comptant', boxX + 14, topY + 49, { width: boxW - 28 });
  if (ref) {
    doc.font('Helvetica').fontSize(7.5).fillColor(C.lgrey)
      .text(`Dossier n° ${ref}`, boxX + 14, topY + 62, { width: boxW - 28 });
  }

  doc.x = M;
  doc.y = topY + boxH + 10;
  hLine(doc, M, doc.y, W, C.rule, 0.75);
  doc.y += 14;
}

// ─── Titre de section ─────────────────────────────────────────────────────────
function drawSectionTitle(doc, text) {
  if (doc.y > PH - M - 90) doc.addPage();
  doc.moveDown(0.5);
  const y = doc.y;
  doc.rect(M, y, 3, 11).fill(C.navy);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.navy)
    .text(text.toUpperCase(), M + 10, y + 1.5, { width: W - 10, characterSpacing: 0.6 });
  doc.x = M;
  doc.y  = y + 17;
}

// ─── Ligne clé / valeur ───────────────────────────────────────────────────────
// Bug corrigé historiquement : mesure les 2 colonnes avant de placer du texte
// pour éviter que doc.y reflète seulement la dernière colonne rendue.
function drawKeyValueRow(doc, label, value, lblW) {
  lblW = lblW || 162;
  const valW = W - lblW - 8;
  const valX = M + lblW + 8;
  const y    = doc.y;
  const lh   = doc.heightOfString(String(label), { width: lblW, fontSize: 9 });
  const vh   = doc.heightOfString(String(value ?? '—'), { width: valW, fontSize: 9 });
  doc.font('Helvetica').fontSize(9).fillColor(C.grey)
    .text(String(label), M, y, { width: lblW });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.body)
    .text(String(value ?? '—'), valX, y, { width: valW });
  doc.x = M;
  doc.y = y + Math.max(lh, vh) + 4;
}

// ─── Encadré client (fond gris clair) ─────────────────────────────────────────
function drawClientBox(doc, lines) {
  const PER_LINE = 13;
  const PAD      = 9;
  const boxH     = lines.length * PER_LINE + 2 * PAD + 4;
  const startY   = doc.y;
  filledRect(doc, M, startY, W, boxH, C.bg, 5);
  doc.x = M;
  doc.y = startY + PAD;
  for (const [lbl, val] of lines) drawKeyValueRow(doc, lbl, val);
  doc.y = Math.max(doc.y, startY + boxH) + 8;
  doc.x = M;
}

// ─── Ligne de prestation (facture) ────────────────────────────────────────────
// Mesure les 2 colonnes avant de placer le texte (même bug que drawKeyValueRow,
// même correctif — 2 colonnes indépendantes, doc.y ne reflèterait que la dernière).
function drawInvoiceItem(doc, { label, detailLines = [], amount }) {
  const amtW = 92;
  const lblW = W - amtW - 6;
  const amtX = M + lblW + 6;
  const y    = doc.y;
  const lh   = doc.heightOfString(label, { width: lblW, fontSize: 9.5 });
  const ah   = doc.heightOfString(amount, { width: amtW, fontSize: 9.5 });
  doc.font('Helvetica').fontSize(9.5).fillColor(C.body)
    .text(label, M, y, { width: lblW });
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.body)
    .text(amount, amtX, y, { width: amtW, align: 'right' });
  doc.x = M;
  doc.y = y + Math.max(lh, ah);
  for (const line of detailLines) {
    doc.font('Helvetica').fontSize(8.5).fillColor(C.grey)
      .text(line, M + 8, doc.y, { width: lblW - 8 });
  }
  doc.x = M;
  doc.moveDown(0.35);
  hLine(doc, M, doc.y, W, C.ruleL, 0.5);
  doc.y += 6;
}

// ─── Tableau prestations : en-tête ───────────────────────────────────────────
// Même bug que drawKeyValueRow : capturer startY avant tout appel .text() pour
// que les deux colonnes soient sur la même ligne, même si la première avance doc.y.
function drawTableHeader(doc) {
  const amtW   = 92;
  const lblW   = W - amtW - 6;
  const startY = doc.y;
  filledRect(doc, M, startY, W, 20, C.bgD, 3);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.navy)
    .text('DÉSIGNATION', M + 6, startY + 6, { width: lblW, characterSpacing: 0.3 });
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.navy)
    .text('MONTANT TTC', M + lblW + 6, startY + 6, { width: amtW, align: 'right', characterSpacing: 0.3 });
  doc.x = M;
  doc.y = startY + 24;
}

// ─── Bloc total (bandeau navy) ────────────────────────────────────────────────
function drawTotalBox(doc, rows) {
  // rows : [{ label, value, bold, large }]
  const ROW_H = 14;
  const PAD   = 10;
  const boxH  = rows.length * ROW_H + 2 * PAD;
  const boxY  = doc.y;
  filledRect(doc, M, boxY, W, boxH, C.navy, 6);
  let ty = boxY + PAD;
  for (const row of rows) {
    const fs  = row.large ? 14 : 9;
    const col = row.muted ? C.wTer : (row.large ? C.white : C.wSec);
    doc.font(row.bold || row.large ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(fs).fillColor(col)
      .text(row.label + (row.large ? '  ' : '  ') + row.value,
            M + 10, ty, { width: W - 20, align: 'right' });
    ty += row.large ? ROW_H + 2 : ROW_H;
  }
  doc.x = M;
  doc.y = boxY + boxH + 16;
}

// ─── Pied de page document ────────────────────────────────────────────────────
function drawFooter(doc, text) {
  hLine(doc, M, doc.y, W, C.ruleL, 0.5);
  doc.y += 6;
  doc.font('Helvetica').fontSize(7.5).fillColor(C.lgrey)
    .text(text, M, doc.y, { width: W, align: 'justify' });
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTRAT DE LOCATION
// Modèle officiel fourni par le propriétaire (Contrat_de_Location_Climatiseur_
// Mobile.pdf, reçu le 2026-07-16) — Articles 1 à 7 repris tels quels, seuls
// les champs sont remplacés par les données réelles de la réservation.
// ══════════════════════════════════════════════════════════════════════════════
function generateContratPdf({ reservation, appareils, acceptations, version }) {
  return renderPdf((doc) => {
    drawContratHeader(doc, reservation.ref);

    const jours  = nbJours(reservation.date_debut, reservation.date_fin);
    const modele = modeleLabel(appareils);
    const entreprise = reservation.type_client === 'entreprise' && reservation.raison_sociale
      ? ` (${reservation.raison_sociale}${reservation.siret ? ', SIRET ' + reservation.siret : ''})` : '';
    const locataireNom = `${reservation.prenom || ''} ${reservation.nom || ''}`.trim();

    // ── Bloc Bailleur / Locataire côte à côte ──────────────────────────────
    const halfW = (W - 12) / 2;
    const boxH  = 74;
    const bY    = doc.y;

    filledRect(doc, M,              bY, halfW, boxH, C.bg, 5);
    filledRect(doc, M + halfW + 12, bY, halfW, boxH, C.bg, 5);

    // Bailleur
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.navy)
      .text('BAILLEUR', M + 10, bY + 9, { width: halfW - 20, characterSpacing: 0.5 });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.body)
      .text(SELLER.nomCommercial, M + 10, bY + 22, { width: halfW - 20 });
    doc.font('Helvetica').fontSize(8.5).fillColor(C.grey)
      .text(`Gérant : Aly THIAM`, M + 10, bY + 35, { width: halfW - 20 })
      .text(SELLER.adresse,                 M + 10, bY + 46, { width: halfW - 20 })
      .text(`SIRET ${SELLER.siret}`,   M + 10, bY + 57, { width: halfW - 20 });

    // Locataire
    const rx = M + halfW + 22;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.navy)
      .text('LOCATAIRE', rx, bY + 9, { width: halfW - 20, characterSpacing: 0.5 });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.body)
      .text(locataireNom + entreprise, rx, bY + 22, { width: halfW - 20 });
    doc.font('Helvetica').fontSize(8.5).fillColor(C.grey)
      .text(reservation.adresse || '—', rx, bY + 35, { width: halfW - 20 })
      .text(reservation.email || '', rx, bY + 47, { width: halfW - 20 });

    doc.x = M;
    doc.y = bY + boxH + 16;

    // ── Récapitulatif de la location ──────────────────────────────────────
    drawSectionTitle(doc, 'Récapitulatif de la location');
    drawKeyValueRow(doc, 'Équipement',  modele);
    drawKeyValueRow(doc, 'Période',     `Du ${fmtDate(reservation.date_debut)} au ${fmtDate(reservation.date_fin)} — ${jours} jours`);
    drawKeyValueRow(doc, 'Adresse de livraison', reservation.adresse || '—');
    drawKeyValueRow(doc, 'Installation',     reservation.installation || 'Kit autonome sans perçage (gratuit)');
    doc.moveDown(0.4);

    // ── Articles ──────────────────────────────────────────────────────────
    function article(num, titre, texte) {
      if (doc.y > PH - M - 110) doc.addPage();
      doc.moveDown(0.7);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.navy)
        .text(`Article ${num} — ${titre}`, M, doc.y, { width: W });
      doc.moveDown(0.25);
      doc.font('Helvetica').fontSize(9).fillColor(C.body)
        .text(texte, M, doc.y, { width: W, align: 'justify', lineGap: 2.5 });
      doc.x = M;
      doc.moveDown(0.4);
      hLine(doc, M, doc.y, W, C.ruleL, 0.5);
      doc.y += 3;
    }

    article(1, 'Parties',
      `Bailleur : ${SELLER.nomCommercial}, exploité par Aly THIAM, ${SELLER.adresse}. SIRET : ${SELLER.siret}.\n` +
      `Locataire : ${locataireNom}${entreprise}, demeurant au ${reservation.adresse || '—'}.`
    );

    const modeleConnu = !!(appareils && appareils[0] && appareils[0].modele);
    article(2, 'Objet', modeleConnu
      ? `Location d’un climatiseur mobile ${modele} (de 9 000 à 12 000 BTU, adapté aux espaces jusqu’à 20 m²) ` +
        `avec kit d’installation complet (gaine, télécommande, kit de calfeutrage sans perçage).`
      : `Location d’un climatiseur mobile (Rowenta RWAC10KA ou FRICO CLIMOB 12, de 9 000 à 12 000 BTU, ` +
        `adapté aux espaces jusqu’à 20 m²) avec kit d’installation complet (gaine, télécommande, kit de calfeutrage sans perçage).`
    );

    article(3, 'Durée',
      `La durée minimale de location est de 7 jours. La location débute le ${fmtDate(reservation.date_debut)} et se termine le ` +
      `${fmtDate(reservation.date_fin)}, pour une durée de ${jours} jours.`
    );

    article(4, 'Tarification & livraison',
      'Tarif journalier (TTC) : 12,00 €/jour (7 jours) · 10,00 €/jour (8 à 14 jours) · ' +
      '9,00 €/jour (15 à 21 jours) · 8,00 €/jour (22 jours et plus). Durée minimale : 7 jours.\n' +
      'Frais de livraison et récupération : 60,00 € (Nice, Saint-Laurent-du-Var, Cagnes-sur-Mer, Villefranche-sur-Mer, ' +
      'Beaulieu-sur-Mer) ou 120,00 € (hors zone).\n' +
      'Option installation par un technicien qualifié : 80,00 € (en option) ou installation en autonomie (gratuite, kit fourni sans perçage).\n' +
      `TVA : ${SELLER.mentionTva}.`
    );

    article(5, 'Modalités de paiement & autorisation',
      reservation.stripe_payment_intent_id
        ? `Le paiement est exigé à la réservation via la solution de paiement sécurisée Stripe. Aucun dépôt de garantie n’est demandé.\n` +
          `Le locataire autorise expressément ${SELLER.nomCommercial} à enregistrer sa carte bancaire de façon sécurisée via Stripe afin de ` +
          `permettre un prélèvement de plein droit en cas de retard de restitution, selon les tarifs de l’article 10 bis des CGV.`
        : `Le paiement est exigé à la réservation. Aucun dépôt de garantie n’est demandé.\n` +
          `Le locataire autorise expressément ${SELLER.nomCommercial} à procéder à un prélèvement de plein droit en cas de retard de restitution, selon les tarifs de l’article 10 bis des CGV.`
    );

    article(6, 'Conditions générales & annulation',
      'Annulation : remboursement intégral pour toute annulation effectuée avant la livraison (prise de contact avant 20h la veille de ' +
      'la livraison prévue). Passé ce délai, aucun remboursement n’est accordé.\n' +
      'Garantie panne : en cas de défaillance technique non imputable au client, l’appareil est dépanné ou remplacé dans les meilleurs ' +
      'délais. À défaut, les jours de location restants sont intégralement remboursés.\n' +
      'Responsabilité : le locataire est responsable de l’utilisation normale de l’appareil conformément aux instructions. Il s’engage ' +
      'à ne pas le déplacer ou tenter de le réparer sans accord préalable.\n' +
      'Rétractation : en signant ce contrat et en demandant la livraison, le locataire renonce expressément à son droit de rétractation ' +
      'de 14 jours pour permettre le début immédiat de la prestation.'
    );

    article(7, 'Litiges & médiation',
      'Contrat soumis au droit français. En cas de litige non résolu à l’amiable, le locataire peut recourir gratuitement au médiateur ' +
      'de la consommation MEDICYS (73 Boulevard de Clichy, 75009 Paris — www.medicys.fr). À défaut, les tribunaux compétents sont ceux de Nice.'
    );

    // ── Acceptation électronique ──────────────────────────────────────────
    drawSectionTitle(doc, 'Acceptation électronique');
    const LABEL_BY_TYPE = {
      cgv_location:           'Conditions générales de vente et de location (CGV/CGL)',
      conditions_utilisation: "Conditions d’utilisation du climatiseur et obligations liées à la location",
      autorisation_retard:    'Autorisation de prélèvement en cas de retard de restitution (art. 10 bis des CGV)',
    };
    if (acceptations && acceptations.length) {
      for (const a of acceptations) {
        drawKeyValueRow(doc, LABEL_BY_TYPE[a.type] || a.type,
          `Acceptées le ${fmtDateHeure(a.accepted_at)} — version ${a.version}`);
      }
    } else {
      drawKeyValueRow(doc, 'Acceptation CGV/CGL',
        `Le ${fmtDateHeure(reservation.cgv_accepted_at)} — version ${version}`);
    }

    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(9).fillColor(C.body)
      .text(`Fait à Nice, le ${fmtDate(new Date())}`, M, doc.y);
    doc.moveDown(1.2);

    // ── Signatures ────────────────────────────────────────────────────────
    const SH = 96;
    if (doc.y + SH > PH - M) doc.addPage();
    const sY   = doc.y;
    const sHW  = (W - 14) / 2;

    filledRect(doc, M,           sY, sHW, SH, C.bg, 5);
    filledRect(doc, M + sHW + 14, sY, sHW, SH, C.bg, 5);

    // Bailleur
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.navy)
      .text('SIGNATURE DU BAILLEUR', M + 10, sY + 10, { width: sHW - 20, characterSpacing: 0.4 });
    doc.font('Helvetica').fontSize(9).fillColor(C.body)
      .text("Aly THIAM — Loc’Air", M + 10, sY + 22, { width: sHW - 20 });
    doc.font('Helvetica').fontSize(8).fillColor(C.lgrey)
      .text('Gérant', M + 10, sY + 38, { width: sHW - 20 });
    hLine(doc, M + 10, sY + 74, sHW - 20, C.rule, 0.5);
    doc.font('Helvetica').fontSize(7.5).fillColor(C.lgrey)
      .text('Signature', M + 10, sY + 79, { width: sHW - 20 });

    // Locataire
    const lx = M + sHW + 24;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.navy)
      .text('SIGNATURE DU LOCATAIRE', lx, sY + 10, { width: sHW - 20, characterSpacing: 0.4 });
    doc.font('Helvetica').fontSize(9).fillColor(C.body)
      .text(locataireNom, lx, sY + 24, { width: sHW - 20 });
    doc.font('Helvetica').fontSize(8).fillColor(C.grey)
      .text('(Précédée de la mention « Lu et approuvé »)', lx, sY + 38, { width: sHW - 20 });
    hLine(doc, lx, sY + 74, sHW - 20, C.rule, 0.5);
    doc.font('Helvetica').fontSize(7.5).fillColor(C.lgrey)
      .text('Signature', lx, sY + 79, { width: sHW - 20 });

    doc.x = M;
    doc.y = sY + SH + 16;

    drawFooter(doc,
      `Contrat généré et accepté électroniquement au moment du paiement — dossier ${reservation.ref}. ` +
      `Conditions générales complètes (CGV/CGL v${version}) consultables sur locair.fr/cgv.`
    );
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// FACTURE DE LOCATION
// Modèle officiel fourni par le propriétaire (reçu le 2026-07-16). Le sous-
// total est recalculé avec _lib/pricing.js ; l'éventuel écart avec le montant
// encaissé apparaît en « Remise commerciale » pour que le total corresponde
// exactement à ce qui a été payé.
// ══════════════════════════════════════════════════════════════════════════════
function generateFacturePdf({ reservation, appareils, numero, datePaiement }) {
  return renderPdf((doc) => {
    drawFactureHeader(doc, numero, datePaiement, reservation.ref);

    // ── Client ────────────────────────────────────────────────────────────
    drawSectionTitle(doc, 'Facturé à');
    const clientLines = [
      ['Nom', `${reservation.prenom || ''} ${reservation.nom || ''}`.trim()],
    ];
    if (reservation.type_client === 'entreprise' && reservation.raison_sociale) {
      clientLines.push(['Raison sociale', reservation.raison_sociale]);
      clientLines.push(['SIRET client', reservation.siret || '—']);
    }
    clientLines.push(['Adresse', reservation.adresse || '—']);
    clientLines.push(['Email', reservation.email || '—']);
    drawClientBox(doc, clientLines);

    // ── Informations facture ──────────────────────────────────────────────
    drawKeyValueRow(doc, 'N° de réservation',  reservation.ref);
    drawKeyValueRow(doc, "Date d’émission",    fmtDate(datePaiement));
    drawKeyValueRow(doc, 'Échéance',            'Réglée comptant à la réservation');
    drawKeyValueRow(doc, "Type d’opération",    'Prestation de services / Location de biens');
    doc.moveDown(0.3);

    // ── Tableau prestations ───────────────────────────────────────────────
    drawSectionTitle(doc, 'Prestations facturées');
    drawTableHeader(doc);

    const jours    = nbJours(reservation.date_debut, reservation.date_fin);
    const qty      = reservation.quantite || 1;
    const totalUn  = calcTieredPrice(jours);
    const tarifMoy = totalUn / jours;
    const locCents = Math.round(totalUn * qty * 100);
    const horsZone = !!reservation.hors_zone;
    const livCents = (horsZone ? 120 : 60) * 100;
    const isTech   = (reservation.installation || '').startsWith('Technicien');
    const instCents = isTech ? 80 * 100 : 0;
    const modele   = modeleLabel(appareils);
    const totalReel = reservation.prix_total_cents || 0;
    const sousTotal = locCents + livCents + instCents;
    const ecart    = totalReel - sousTotal;

    drawInvoiceItem(doc, {
      label: `Location climatiseur mobile — ${modele}`,
      detailLines: [
        `Période : du ${fmtDate(reservation.date_debut)} au ${fmtDate(reservation.date_fin)} (${jours} jours)`,
        `Quantité : ${qty} climatiseur${qty > 1 ? 's' : ''} — tarif moyen ${eur(Math.round(tarifMoy * 100))}/jour (tarif dégressif)`,
      ],
      amount: eur(locCents),
    });

    drawInvoiceItem(doc, {
      label: `Livraison & récupération — zone : ${horsZone ? 'hors zone' : 'Nice et environs'}`,
      amount: eur(livCents),
    });

    drawInvoiceItem(doc, {
      label: isTech ? 'Option installation par technicien qualifié' : 'Installation en autonomie (kit fourni sans perçage)',
      amount: isTech ? eur(instCents) : 'Offert',
    });

    if (Math.abs(ecart) >= 1) {
      drawInvoiceItem(doc, {
        label:  ecart < 0 ? 'Remise commerciale' : 'Ajustement',
        amount: (ecart < 0 ? '− ' : '+ ') + eur(Math.abs(ecart)),
      });
    }

    doc.moveDown(0.3);

    // ── Total ─────────────────────────────────────────────────────────────
    drawTotalBox(doc, [
      { label: 'Sous-total HT',                     value: eur(sousTotal), muted: true },
      { label: `TVA (0 % — ${SELLER.mentionTva})`, value: '0,00 €', muted: true },
      { label: 'NET À PAYER',                   value: eur(totalReel), bold: true, large: true },
    ]);

    // ── Paiement ──────────────────────────────────────────────────────────
    drawSectionTitle(doc, 'Moyen de paiement');
    if (reservation.stripe_payment_intent_id) {
      doc.font('Helvetica').fontSize(9).fillColor(C.body)
        .text('Paiement en ligne sécurisé via Stripe (carte bancaire).', M, doc.y, { width: W });
      doc.x = M;
      doc.font('Helvetica').fontSize(8.5).fillColor(C.lgrey)
        .text(`Identifiant de transaction : ${reservation.stripe_payment_intent_id}`, M, doc.y, { width: W });
    } else {
      doc.font('Helvetica').fontSize(9).fillColor(C.body)
        .text('Paiement encaissé à la réservation.', M, doc.y, { width: W });
    }
    doc.x = M;
    doc.moveDown(0.5);

    // ── Conditions de règlement ───────────────────────────────────────────
    drawSectionTitle(doc, 'Conditions de règlement');
    doc.font('Helvetica').fontSize(8.5).fillColor(C.grey)
      .text(
        "Tout retard de paiement entraînera l’application de pénalités de retard calculées sur la base de 3 fois le taux " +
        "d’intérêt légal, ainsi qu’une indemnité forfaitaire pour frais de recouvrement de 40 €. En cas de retard " +
        "de restitution de l’appareil à la date d’échéance prévue, les jours supplémentaires seront facturés de plein " +
        `droit et prélevés sur le moyen de paiement enregistré, conformément à l’article 10 bis des CGV de ${SELLER.nomCommercial}.`,
        M, doc.y, { width: W, align: 'justify' }
      );
    doc.x = M;
    doc.moveDown(0.8);

    drawFooter(doc,
      `Pour toute question : ${SELLER.email} ou ${SELLER.tel} (7j/7 · 8h–20h). ` +
      `Accédez à votre espace client avec le numéro de réservation ${reservation.ref}.`
    );
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// FACTURE DE VENTE — Offre Privilège
// Le client achète le climatiseur qu'il a en location : pas de dates de
// location, juste la vente d'une unité identifiée.
// ══════════════════════════════════════════════════════════════════════════════
function generateFactureVentePdf({ reservation, appareil, numero, montantCents, datePaiement }) {
  return renderPdf((doc) => {
    drawFactureHeader(doc, numero, datePaiement, reservation.ref, 'FACTURE DE VENTE');

    // ── Client ────────────────────────────────────────────────────────────
    drawSectionTitle(doc, 'Facturé à');
    const clientLines = [
      ['Nom', `${reservation.prenom || ''} ${reservation.nom || ''}`.trim()],
    ];
    if (reservation.type_client === 'entreprise' && reservation.raison_sociale) {
      clientLines.push(['Raison sociale', reservation.raison_sociale]);
      clientLines.push(['SIRET client', reservation.siret || '—']);
    }
    clientLines.push(['Adresse', reservation.adresse || '—']);
    clientLines.push(['Email', reservation.email || '—']);
    drawClientBox(doc, clientLines);

    drawKeyValueRow(doc, 'N° de facture',    numero);
    drawKeyValueRow(doc, 'N° de commande',   reservation.ref);
    drawKeyValueRow(doc, 'Date de paiement',      fmtDate(datePaiement));
    doc.moveDown(0.3);

    // ── Tableau ───────────────────────────────────────────────────────────
    drawSectionTitle(doc, 'Détail de la vente');
    drawTableHeader(doc);

    const modStr = appareil && appareil.modele
      ? ` · ${[appareil.modele.marque || '', appareil.modele.modele || ''].filter(Boolean).join(' ')}`
      : '';
    drawInvoiceItem(doc, {
      label: 'Vente climatiseur mobile — Offre Privilège',
      detailLines: [
        `Unité n° ${appareil?.numero ?? '—'}${modStr}`,
        'Quantité : 1 climatiseur',
      ],
      amount: eur(montantCents),
    });

    doc.moveDown(0.3);

    // ── Total ─────────────────────────────────────────────────────────────
    drawTotalBox(doc, [
      { label: `TVA (0 % — ${SELLER.mentionTva})`, value: '0,00 €', muted: true },
      { label: 'NET À PAYER', value: eur(montantCents), bold: true, large: true },
    ]);

    // ── Note de vente ─────────────────────────────────────────────────────
    drawSectionTitle(doc, 'Informations complémentaires');
    doc.font('Helvetica').fontSize(8.5).fillColor(C.grey)
      .text(
        `Cette facture correspond à l'acquisition définitive du climatiseur mobile loué dans le cadre du dossier n° ${reservation.ref}. ` +
        "L'appareil est vendu avec l'ensemble de ses accessoires d'origine (gaine, télécommande, kit de calfeutrage). " +
        "La garantie constructeur s'applique dans les conditions prévues par le fabricant.",
        M, doc.y, { width: W, align: 'justify' }
      );
    doc.x = M;
    doc.moveDown(0.8);

    drawFooter(doc,
      `${SELLER.raisonSociale} (${SELLER.nomCommercial}) · ${SELLER.formeJuridique} · SIRET ${SELLER.siret} · ${SELLER.adresse}. ` +
      'Facture émise conformément aux articles L441-9 et suivants du Code de commerce. ' +
      'Aucun escompte pour paiement anticipé. Pénalités de retard : sans objet (paiement comptant préalable à la vente).'
    );
  });
}

module.exports = { generateContratPdf, generateFacturePdf, generateFactureVentePdf };
