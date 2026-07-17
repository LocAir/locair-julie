const PDFDocument = require('pdfkit');
const { SELLER } = require('./legal');
const { calcTieredPrice } = require('./pricing');

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

// Nombre de jours entre deux dates 'YYYY-MM-DD' (UTC minuit des deux côtés,
// même convention que addDays dans _lib/dates.js — évite tout décalage lié
// au fuseau horaire du serveur).
function nbJours(dateDebut, dateFin) {
  const d1 = new Date(dateDebut + 'T00:00:00Z');
  const d2 = new Date(dateFin + 'T00:00:00Z');
  return Math.max(1, Math.round((d2 - d1) / 86400000));
}

function modeleLabel(appareils) {
  const m = appareils && appareils[0] && appareils[0].modele;
  return m ? `${m.marque} ${m.modele}` : "Rowenta RWAC10KA ou FRICO CLIMOB 12 (9 000 à 12 000 BTU)";
}

function drawHeader(doc, title) {
  doc.fontSize(18).fillColor('#1b3a5f').text(SELLER.nomCommercial, { continued: false });
  doc.fontSize(9).fillColor('#666')
    .text(`Gérant : Aly THIAM — ${SELLER.formeJuridique}`)
    .text(`${SELLER.adresse}`)
    .text(`SIRET ${SELLER.siret} · ${SELLER.tel} · ${SELLER.email}`);
  doc.moveDown(1);
  doc.fontSize(15).fillColor('#111').text(title);
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').stroke();
  doc.moveDown(0.8);
}

// Bug corrigé le 2026-07-16 : cette fonction avançait doc.y d'une hauteur
// fixe (moveDown(0.35)), correct seulement si label ET valeur tiennent sur
// une seule ligne. Dès qu'un des deux textes est assez long pour passer à la
// ligne (ex. les libellés de la section "Acceptation électronique" du
// contrat), la ligne suivante venait chevaucher la fin de celle-ci — et
// laissait en plus doc.x bloqué sur la colonne de droite (220), faisant
// perdre une partie du texte des paragraphes appelés juste après. On mesure
// désormais la hauteur réelle des deux colonnes et on réinitialise doc.x.
function drawKeyValueRow(doc, label, value) {
  const y = doc.y;
  const labelWidth = 160, valueWidth = 325;
  const valueStr = String(value ?? '—');
  const labelHeight = doc.heightOfString(String(label), { width: labelWidth, fontSize: 10 });
  const valueHeight = doc.heightOfString(valueStr, { width: valueWidth, fontSize: 10 });
  doc.fontSize(10).fillColor('#666').text(label, 50, y, { width: labelWidth });
  doc.fontSize(10).fillColor('#111').text(valueStr, 220, y, { width: valueWidth });
  doc.x = 50;
  doc.y = y + Math.max(labelHeight, valueHeight) + 5;
}

function drawSectionTitle(doc, text) {
  doc.moveDown(0.6);
  doc.fontSize(11).fillColor('#1b3a5f').text(text);
  doc.moveDown(0.2);
}

// Une ligne de prestation facturée — libellé + détail (gris, indenté) à
// gauche, montant aligné à droite — puis un filet séparateur fin.
// Mesure la hauteur réelle des 2 colonnes (label à gauche, montant à droite)
// avant de placer les lignes de détail sous la plus haute des deux — même
// bug de fond que l'ancien drawKeyValueRow (voir son commentaire) : se fier
// à doc.y après un simple appel .text() dépend de l'ordre des appels et ne
// tient pas compte du wrapping, d'où ce calcul explicite.
function drawInvoiceItem(doc, { label, detailLines = [], amount }) {
  const y = doc.y;
  const labelWidth = 375, amountWidth = 120;
  const labelHeight = doc.heightOfString(label, { width: labelWidth, fontSize: 10.5 });
  const amountHeight = doc.heightOfString(amount, { width: amountWidth, fontSize: 10.5 });
  doc.fontSize(10.5).fillColor('#111').text(label, 50, y, { width: labelWidth });
  doc.fontSize(10.5).fillColor('#111').text(amount, 425, y, { width: amountWidth, align: 'right' });
  doc.x = 50;
  doc.y = y + Math.max(labelHeight, amountHeight);
  // Pour les lignes de détail, doc.y avance correctement tout seul après
  // chaque .text() (pdfkit calcule la hauteur réelle du texte rendu) — pas
  // besoin de la recalculer nous-mêmes ici, contrairement au tandem
  // label/montant ci-dessus (2 colonnes indépendantes, doc.y ne reflète que
  // la dernière des deux sans le correctif au-dessus).
  for (const line of detailLines) {
    doc.fontSize(9).fillColor('#666').text(line, 60, doc.y, { width: 365 });
  }
  doc.x = 50;
  doc.moveDown(0.3);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#eee').stroke();
  doc.moveDown(0.5);
}

// ── Contrat de location ────────────────────────────────────────────────────
// Modèle officiel fourni par le propriétaire (Contrat_de_Location_Climatiseur_
// Mobile.pdf, reçu le 2026-07-16) — Articles 1 à 7 repris tels quels, seuls
// les champs entre accolades du modèle sont remplacés par les données réelles
// de la réservation. Une version avec signature manuscrite scannée doit
// remplacer celle-ci dès qu'elle sera fournie (voir emplacement Signature du
// Bailleur ci-dessous, actuellement texte seul).
function generateContratPdf({ reservation, appareils, acceptations, version }) {
  return renderPdf((doc) => {
    doc.fontSize(16).fillColor('#111').text("CONTRAT DE LOCATION — CLIMATISEUR MOBILE", { align: 'center' });
    doc.moveDown(1.2);

    const jours = nbJours(reservation.date_debut, reservation.date_fin);
    const modele = modeleLabel(appareils);
    const entreprise = reservation.type_client === 'entreprise' && reservation.raison_sociale
      ? ` (${reservation.raison_sociale}${reservation.siret ? ', SIRET ' + reservation.siret : ''})` : '';

    function article(titre, texte) {
      doc.fontSize(11).fillColor('#1b3a5f').text(titre);
      doc.moveDown(0.3);
      doc.fontSize(9.5).fillColor('#222').text(texte, { width: 495, align: 'justify', lineGap: 2 });
      doc.moveDown(0.9);
    }

    article('ARTICLE 1 - PARTIES',
      `Le Bailleur : ${SELLER.nomCommercial}, exploité par Aly THIAM, ${SELLER.adresse}. SIRET : ${SELLER.siret}.\n` +
      `Le Locataire : ${(reservation.prenom || '') + ' ' + (reservation.nom || '')}${entreprise}, demeurant au ${reservation.adresse || '—'}.`
    );

    // Le modèle générique (Rowenta/FRICO) n'est utile qu'en l'absence d'unité
    // assignée — dès qu'un climatiseur précis est connu, le répéter juste
    // après son nom est redondant et se lisait mal (ex. "climatiseur mobile
    // Rowenta RWAC10KA (Rowenta RWAC10KA ou FRICO CLIMOB 12...)").
    const modeleConnu = !!(appareils && appareils[0] && appareils[0].modele);
    article('ARTICLE 2 - OBJET', modeleConnu
      ? `Location d'un climatiseur mobile ${modele} (climatiseur mobile de 9 000 à 12 000 BTU, adapté aux espaces jusqu'à 20 m²) ` +
        "avec kit d'installation complet (gaine, télécommande, kit de calfeutrage sans perçage)."
      : "Location d'un climatiseur mobile (Rowenta RWAC10KA ou FRICO CLIMOB 12, de 9 000 BTU à 12 000 BTU, adapté aux espaces " +
        "jusqu'à 20 m²) avec kit d'installation complet (gaine, télécommande, kit de calfeutrage sans perçage)."
    );

    article('ARTICLE 3 - DURÉE',
      `La durée minimale de location est de 3 jours. La location débute le ${fmtDate(reservation.date_debut)} et se termine le ` +
      `${fmtDate(reservation.date_fin)}, pour une durée de ${jours} jours.`
    );

    article('ARTICLE 4 - TARIFICATION & LIVRAISON',
      "Tarif journalier (TTC) : 24,00 €/jour (3 à 6 jours) · 20,00 €/jour (7 jours) · 18,00 €/jour (8 à 14 jours) · 17,00 €/jour (15 à 21 jours) · 16,00 €/jour (22 jours et plus).\n" +
      "Frais de livraison et récupération : 35,00 € (Nice, Saint-Laurent-du-Var, Cagnes-sur-Mer, Villefranche-sur-Mer, Beaulieu-sur-Mer) ou 95,00 € (hors zone).\n" +
      "Option installation par un technicien qualifié : 49,00 € (en option) ou installation en autonomie (gratuite, kit fourni sans perçage).\n" +
      `TVA : ${SELLER.mentionTva}.`
    );

    article('ARTICLE 5 - MODALITÉS DE PAIEMENT & AUTORISATION',
      "Le paiement est exigé à la réservation via la solution de paiement sécurisée Stripe. Aucun dépôt de garantie n'est demandé.\n" +
      `Le locataire autorise expressément ${SELLER.nomCommercial} à enregistrer sa carte bancaire de façon sécurisée via Stripe afin de ` +
      "permettre un prélèvement de plein droit en cas de retard de restitution, selon les tarifs de l'article 10 bis des CGV."
    );

    article('ARTICLE 6 - CONDITIONS GÉNÉRALES & ANNULATION',
      "Annulation : remboursement intégral pour toute annulation effectuée avant la livraison (prise de contact avant 20h la veille de " +
      "la livraison prévue). Passé ce délai, aucun remboursement n'est accordé.\n" +
      "Garantie panne : en cas de défaillance technique non imputable au client, l'appareil est dépanné ou remplacé dans les meilleurs " +
      "délais. À défaut, les jours de location restants sont intégralement remboursés.\n" +
      "Responsabilité : le locataire est responsable de l'utilisation normale de l'appareil conformément aux instructions. Il s'engage " +
      "à ne pas le déplacer ou tenter de le réparer sans accord préalable.\n" +
      "Rétractation : en signant ce contrat et en demandant la livraison, le locataire renonce expressément à son droit de rétractation " +
      "de 14 jours pour permettre le début immédiat de la prestation."
    );

    article('ARTICLE 7 - LITIGES & MÉDIATION',
      "Contrat soumis au droit français. En cas de litige non résolu à l'amiable, le locataire peut recourir gratuitement au médiateur " +
      "de la consommation MEDICYS (73 Boulevard de Clichy, 75009 Paris — www.medicys.fr). À défaut, les tribunaux compétents sont ceux de Nice."
    );

    // Preuve d'acceptation électronique (case à cocher + horodatage) — vient
    // en complément du texte légal ci-dessus, propre à une location conclue
    // en ligne plutôt que par signature manuscrite au moment du paiement.
    drawSectionTitle(doc, 'Acceptation électronique');
    if (acceptations && acceptations.length) {
      for (const a of acceptations) {
        const label = a.type === 'cgv_location'
          ? 'Conditions générales de vente et de location (CGV/CGL)'
          : "Conditions d'utilisation du climatiseur et obligations liées à la location";
        drawKeyValueRow(doc, label, `Acceptées le ${fmtDateHeure(a.accepted_at)} — version ${a.version}`);
      }
    } else {
      drawKeyValueRow(doc, 'Acceptation CGV/CGL', `Le ${fmtDateHeure(reservation.cgv_accepted_at)} — version ${version}`);
    }

    doc.moveDown(0.8);
    doc.fontSize(9.5).fillColor('#111').text(`Fait à Nice, le ${fmtDate(new Date())}`);
    doc.moveDown(1.5);

    // Bloc signatures : les 2 lignes sont positionnées à des coordonnées
    // absolues (2 colonnes) — sans ce garde-fou, si le bloc tombait près du
    // bas de page, pdfkit pouvait insérer un saut de page entre les deux
    // lignes de chaque colonne, éparpillant "Aly THIAM" et la mention du
    // locataire sur la page suivante (bug observé et corrigé le 2026-07-16).
    const SIGNATURE_BLOCK_HEIGHT = 90;
    if (doc.y + SIGNATURE_BLOCK_HEIGHT > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
    const ySign = doc.y;
    doc.fontSize(9.5).fillColor('#111').text('Signature du Bailleur :', 50, ySign);
    doc.text("Aly THIAM (Loc'Air)", 50, ySign + 34);
    doc.fontSize(9.5).text('Signature du Locataire :', 300, ySign);
    doc.text('(Précédée de la mention « Lu et approuvé »)', 300, ySign + 34, { width: 200 });

    doc.x = 50;
    doc.y = ySign + SIGNATURE_BLOCK_HEIGHT;
    doc.fontSize(8).fillColor('#888').text(
      `Contrat généré et accepté électroniquement au moment du paiement — dossier ${reservation.ref}. ` +
      `Conditions générales complètes (CGV/CGL v${version}) consultables sur locair.fr/cgv.`,
      { width: 495 }
    );
  });
}

// ── Facture de location ──────────────────────────────────────────────────
// Modèle officiel fourni par le propriétaire (reçu le 2026-07-16, frais
// d'installation corrigés à 49 € pour rester cohérents avec INSTALL_FEE dans
// checkout.js/index.html). Le sous-total des prestations (location + livraison
// + installation) est recalculé avec la même formule que la réservation
// (_lib/pricing.js) ; un éventuel écart avec le montant réellement encaissé
// (ex. code promo) apparaît en ligne "Remise commerciale" pour que le total
// affiché corresponde toujours exactement à ce qui a été payé.
function generateFacturePdf({ reservation, appareils, numero, datePaiement }) {
  return renderPdf((doc) => {
    drawHeader(doc, `Facture ${numero}`);

    doc.fontSize(9).fillColor('#666').text(`Réservation n° ${reservation.ref}`);
    doc.fontSize(7.5).fillColor('#999').text(
      "Identifiant unique pour la gestion de votre dossier et l'accès à votre espace personnel.", { width: 495 }
    );
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#666').text(`Date d'émission : ${fmtDate(datePaiement)} · Échéance : réglée comptant à la réservation`);
    doc.text('Type d\'opération : Prestation de services / Location de biens');
    doc.moveDown(0.8);

    drawSectionTitle(doc, 'Facturé à');
    drawKeyValueRow(doc, 'Nom', `${reservation.prenom || ''} ${reservation.nom || ''}`.trim());
    if (reservation.type_client === 'entreprise' && reservation.raison_sociale) {
      drawKeyValueRow(doc, 'Raison sociale', reservation.raison_sociale);
      drawKeyValueRow(doc, 'SIRET client', reservation.siret || '—');
    }
    drawKeyValueRow(doc, 'Adresse', reservation.adresse || '—');
    drawKeyValueRow(doc, 'Email', reservation.email || '—');

    drawSectionTitle(doc, 'Désignation des prestations');

    const jours = nbJours(reservation.date_debut, reservation.date_fin);
    const qty = reservation.quantite || 1;
    // calcTieredPrice renvoie le total dégressif pour la durée (ex. 266 € pour
    // 14 jours : 7×20 + 7×18), pas un tarif journalier fixe — le tarif moyen
    // affiché ci-dessous reprend le même calcul que le simulateur du site
    // (_baseRate = prix total / nombre de jours, voir index.html).
    const totalUnClim = calcTieredPrice(jours);
    const tarifJourMoyen = totalUnClim / jours;
    const montantLocationCents = Math.round(totalUnClim * qty * 100);
    const isHorsZone = !!reservation.hors_zone;
    const montantLivraisonCents = (isHorsZone ? 95 : 35) * 100;
    const isTech = (reservation.installation || '').startsWith('Technicien');
    const montantInstallCents = isTech ? 49 * 100 : 0;
    const modele = modeleLabel(appareils);

    drawInvoiceItem(doc, {
      label: `Location climatiseur mobile — ${modele}`,
      detailLines: [
        `Période : du ${fmtDate(reservation.date_debut)} au ${fmtDate(reservation.date_fin)} (${jours} jours)`,
        `Quantité : ${qty} climatiseur${qty > 1 ? 's' : ''} — soit ${eur(Math.round(tarifJourMoyen * 100))}/jour en moyenne (tarif dégressif)`,
      ],
      amount: eur(montantLocationCents),
    });

    drawInvoiceItem(doc, {
      label: `Livraison & récupération (zone : ${isHorsZone ? 'hors zone' : 'Nice et environs'})`,
      amount: eur(montantLivraisonCents),
    });

    drawInvoiceItem(doc, {
      label: isTech ? 'Option installation par technicien qualifié' : 'Installation en autonomie (kit fourni)',
      amount: eur(montantInstallCents),
    });

    const totalReelCents = reservation.prix_total_cents || 0;
    const sousTotalCents = montantLocationCents + montantLivraisonCents + montantInstallCents;
    const ecartCents = totalReelCents - sousTotalCents;
    if (Math.abs(ecartCents) >= 1) {
      drawInvoiceItem(doc, {
        label: ecartCents < 0 ? 'Remise commerciale' : 'Ajustement',
        amount: (ecartCents < 0 ? '- ' : '') + eur(Math.abs(ecartCents)),
      });
    }

    doc.moveDown(0.2);
    doc.fontSize(11).fillColor('#111').text(`TOTAL TTC : ${eur(totalReelCents)}`, { align: 'right' });
    doc.fontSize(9).fillColor('#666').text('TVA (0 %) : 0,00 €', { align: 'right' });
    doc.fontSize(12).fillColor('#111').text(`NET À PAYER : ${eur(totalReelCents)}`, { align: 'right' });

    doc.moveDown(0.8);
    doc.fontSize(8).fillColor('#666').text(`Mention légale : ${SELLER.mentionTva} (micro-entreprise en franchise de TVA).`, { width: 495 });

    drawSectionTitle(doc, 'Moyens de paiement');
    doc.fontSize(9).fillColor('#444').text('Payé en ligne via Stripe (carte bancaire).');
    if (reservation.stripe_payment_intent_id) {
      doc.text(`Identifiant de transaction Stripe : ${reservation.stripe_payment_intent_id}`);
    }

    drawSectionTitle(doc, 'Conditions de règlement & retard');
    doc.fontSize(8).fillColor('#666').text(
      "Tout retard de paiement entraînera l'application de pénalités de retard calculées sur la base de 3 fois le taux d'intérêt légal, " +
      "ainsi qu'une indemnité forfaitaire pour frais de recouvrement de 40 €. En cas de retard de restitution de l'appareil à la date " +
      "d'échéance prévue, les jours supplémentaires seront facturés de plein droit et prélevés sur le moyen de paiement enregistré, " +
      `conformément à l'article 10 bis des CGV de ${SELLER.nomCommercial}.`,
      { width: 495 }
    );

    doc.moveDown(0.8);
    doc.fontSize(8).fillColor('#888').text(
      `Pour toute question ou pour accéder à votre espace client, munissez-vous de votre numéro de réservation : ${SELLER.email} ou ${SELLER.tel} (7j/7 · 8h-20h).`,
      { width: 495 }
    );
  });
}

// ── Facture de vente (Offre Privilège) ──────────────────────────────────────
// Le client achète le climatiseur qu'il a déjà en location au lieu de le
// rendre — pas de dates de location ici, juste la vente d'une unité précise.
function generateFactureVentePdf({ reservation, appareil, numero, montantCents, datePaiement }) {
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
    drawKeyValueRow(doc, 'Désignation', `Vente climatiseur mobile — Unité n°${appareil?.numero ?? '—'} (Offre Privilège)`);
    drawKeyValueRow(doc, 'Quantité', '1 climatiseur');

    doc.moveDown(0.4);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').stroke();
    doc.moveDown(0.4);
    doc.fontSize(12).fillColor('#111').text(`Montant payé (TTC) : ${eur(montantCents)}`, { align: 'right' });
    doc.fontSize(9).fillColor('#666').text(SELLER.mentionTva, { align: 'right' });

    doc.moveDown(1.2);
    doc.fontSize(8).fillColor('#888').text(
      `${SELLER.raisonSociale} (${SELLER.nomCommercial}) · ${SELLER.formeJuridique} · SIRET ${SELLER.siret} · ${SELLER.adresse}. ` +
      'Facture émise conformément aux articles L441-9 et suivants du Code de commerce. Aucun escompte pour paiement anticipé. ' +
      "Pénalités de retard : sans objet (paiement comptant préalable à la vente).",
      { width: 495 }
    );
  });
}

module.exports = { generateContratPdf, generateFacturePdf, generateFactureVentePdf };
