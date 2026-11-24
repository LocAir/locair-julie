// Convention de partenariat point de retrait (V11) en PDF, pré-remplie avec
// la fiche de prospection (enseigne, gérant, contact, capacité) et, une fois
// signée sur /partenaires, avec la signature du commerçant.
// Texte = convention V11 (24/11/2026) avec les deux décisions du
// propriétaire écrites dans CLAUDE.md : vol ou casse dans la boutique payés
// par Loc'Air sauf faute grave (article 6) et saison 2027.
const PDFDocument = require('pdfkit');

const BLEU = '#1A5EDB', ENCRE = '#0E1726', GRIS = '#4B5873', CLAIR = '#EFF4FD', TRAIT = '#D5DEEE';
const M = 50, PW = 595.28, W = PW - 2 * M;

const LOCAIR = [
  ['Enseigne', 'Loc’Air (locair.fr)'],
  ['Représentant', 'Aly THIAM, Gérant'],
  ['Adresse', '11 Av. Chantal, 06100 Nice'],
  ['SIRET', '853 730 562 00024 — Greffe de Nice'],
  ['E-mail', 'partenaires.locair@outlook.com'],
  ['Téléphone', '06 63 79 87 56'],
];

const ESSENTIEL = [
  ['Dépose & saison', 'Dépose entre le 10 et le 15 mai 2027, saison active de fin mai à fin septembre (environ 120 jours), sans livraison à domicile.'],
  ['Rémunération', '20 % des locations encaissées (hors annulations remboursées), sans minimum garanti ; 0 € fixe à la charge du partenaire.'],
  ['Stock & rangement', 'Stock fixe chez le commerçant (pas de rotation ni de transfert), nombre fixé à la signature et modifiable d’un commun accord, rangé contre un mur sous housse bleue unie sans logo, gaine d’évacuation au-dessus ; retrait et retour au même point.'],
  ['Entretien & pannes', 'Passage de l’agent Loc’Air tous les 10 jours ; appareil en panne repris et remplacé par Loc’Air.'],
  ['Vol ou casse', 'Dans la boutique : Loc’Air paie, sauf faute grave du partenaire.'],
  ['Résiliation', 'Libre à tout moment par écrit (e-mail ou SMS) avec 7 jours de préavis.'],
];

const ARTICLES = [
  ['Article 1 — Dépose (10–15 mai), saison active, stock fixe & parcours', [
    'La présente convention est conclue sans engagement de durée initiale et se reconduit tacitement aux mêmes conditions.',
    'Les climatiseurs mobiles sont déposés entre le 10 et le 15 mai 2027 pour une saison active de fin mai à fin septembre (environ 4 mois / 120 jours actifs). Loc’Air n’assure aucune livraison à domicile depuis le point : le service fonctionne en Click & Collect via les points de retrait partenaires.',
    'Le partenaire met à disposition un espace intérieur sec, sécurisé et accessible aux heures d’ouverture habituelles (environ 40 × 40 cm par appareil sur roulettes).',
    'Stock fixe sans rotation ni transfert : chaque point reçoit un stock fixe d’appareils, fixé à la signature selon la place disponible. Ce nombre peut évoluer à tout moment d’un commun accord (confirmation écrite par e-mail). Aucune rotation ni transfert d’appareils n’a lieu d’un commerçant à un autre.',
    'Le client retire et rapporte l’appareil au même point de retrait. Si un point est complet ou indisponible, le client peut être orienté vers un autre point du réseau.',
  ]],
  ['Article 2 — Commission de 20 % & règlement', [
    'Le partenaire perçoit 20 % des locations encaissées (locations initiales et prolongations payées, hors annulations remboursées).',
    'Les sommes dues sont versées par virement entre le 1er et le 5 du mois suivant, sur relevé récapitulatif. Les éventuels encaissements de mai figurent sur le relevé de juin.',
    'Règlement selon le régime applicable (micro-entreprise, art. 293 B du CGI, puis régime fiscal de la société d’exploitation immatriculée au greffe de Nice).',
  ]],
  ['Article 3 — 100 % en ligne : zéro caisse, zéro caution', [
    'Réservation, paiement en ligne (sans caution), prolongations et support client sont gérés à 100 % sur locair.fr.',
    'Le partenaire n’encaisse aucun règlement au comptoir, ne gère aucune caution et ne fait signer aucun contrat au client.',
  ]],
  ['Article 4 — Rangement, retrait (identité) & retour (code commerçant)', [
    'Les appareils sont maintenus à l’intérieur, rangés contre un mur, protégés par une housse bleue unie sans logo, avec la gaine d’évacuation au-dessus.',
    'Au retrait : le client montre l’écran de confirmation et une pièce d’identité à son nom ; le partenaire la regarde seulement (sans copie ni conservation) et remet l’appareil avec sa housse et sa gaine.',
    'Au retour : le client rapporte l’appareil (avec gaine et housse) au même point. Le partenaire récupère l’appareil et communique son code commerçant pour que le client valide le retour sur son téléphone. Accessoire manquant, dégradation ou salissure visible : le partenaire reprend l’appareil et prévient Loc’Air tout de suite (photo par WhatsApp, e-mail ou au 06 63 79 87 56).',
  ]],
  ['Article 5 — Entretien assuré par Loc’Air (tous les 10 jours)', [
    'Aucun nettoyage approfondi, contrôle technique ni vidange n’est à la charge du partenaire.',
    'Un agent Loc’Air passe en boutique tous les 10 jours aux heures d’ouverture (contrôle, filtres, purge éventuelle).',
  ]],
  ['Article 6 — Propriété, appareils défectueux & responsabilités', [
    'Les climatiseurs, housses, gaines et le stock tampon restent la propriété exclusive de Loc’Air (puis de la société d’exploitation après transfert). Le partenaire s’interdit tout prêt, sous-location, cession ou déplacement hors du point sans accord écrit de Loc’Air.',
    'Appareil en panne : récupération simple par le partenaire sans diagnostic, mise à l’écart, puis reprise, échange ou remplacement par Loc’Air lors des passages ou via le stock tampon.',
    'Règle du 0 € : aucun frais n’est à la charge du partenaire. Vol ou casse d’un appareil dans la boutique : Loc’Air paie, sauf faute grave du partenaire. Les incidents survenant chez le client ou pendant son transport relèvent de la location du client.',
    'Chaque partie maintient une assurance couvrant son activité et ses locaux (dont la RC Pro de Loc’Air).',
  ]],
  ['Article 7 — Transfert à la société d’exploitation', [
    'Le partenaire accepte que la présente convention, ses droits et obligations, le matériel et les flux de paiement, de facturation et de relevés puissent être transférés de plein droit par Loc’Air à la société d’exploitation (immatriculée au greffe de Nice) dès sa constitution, sans nouvel accord du partenaire.',
    'Une notification écrite (e-mail ou SMS) précisant la dénomination, le SIRET/RCS et la date d’effet vaut information du partenaire.',
  ]],
  ['Article 8 — Résiliation libre (7 jours) & droit applicable', [
    'Résiliable à tout moment par écrit (e-mail ou SMS) avec 7 jours de préavis, suivie de la reprise du matériel par Loc’Air (ou par la société d’exploitation après transfert).',
    'Droit français — juridictions compétentes de Nice.',
  ]],
];

const frDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' });
const frHeure = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

function titre(doc, t) {
  doc.moveDown(0.6);
  if (doc.y > 740) doc.addPage();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BLEU).text(t.toUpperCase(), M, doc.y, { width: W, characterSpacing: 0.5 });
  doc.moveDown(0.4);
}

// fiche : ligne de prospection_points ; signaturePng : Buffer (optionnel)
function generateConventionPdf(fiche, signaturePng) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M, info: { Title: 'Convention de partenariat Loc’Air — point de retrait', Author: 'Loc’Air' } });
    const out = [];
    doc.on('data', (c) => out.push(c));
    doc.on('end', () => resolve(Buffer.concat(out)));
    doc.on('error', reject);
    const f = fiche || {};
    const signe = !!(f.signe_at && signaturePng);

    // En-tête
    doc.rect(0, 0, PW, 92).fill(BLEU);
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#FFFFFF').text('Loc’Air', M, 28);
    doc.font('Helvetica').fontSize(10).fillColor('#DCE6FA').text('Convention de partenariat · Point de retrait Click & Collect', M, 54);
    doc.text(signe ? `Signée le ${frDate(f.signe_at)}` : 'À signer', M, 54, { width: W, align: 'right' });
    doc.y = 112;

    // 1. Parties
    titre(doc, '1. Les parties');
    const y0 = doc.y, colW = (W - 16) / 2;
    const bloc = (x, tete, lignes) => {
      doc.rect(x, y0, colW, 22).fill(CLAIR);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(ENCRE).text(tete, x + 10, y0 + 7, { width: colW - 20 });
      let y = y0 + 30;
      for (const [k, v] of lignes) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor(GRIS).text(k, x + 10, y, { width: colW - 20 });
        y = doc.y;
        doc.font('Helvetica').fontSize(10).fillColor(ENCRE).text(v || '______________________________', x + 10, y, { width: colW - 20 });
        y = doc.y + 5;
      }
      return y;
    };
    const vide = '';
    const yA = bloc(M, 'LOC’AIR (OPÉRATEUR)', LOCAIR);
    const yB = bloc(M + colW + 16, 'PARTENAIRE POINT DE RETRAIT', [
      ['Commerce / enseigne', f.enseigne || vide],
      ['Adresse & accès', f.adresse || (f.zone ? `${f.zone} — adresse à compléter` : vide)],
      ['Dirigeant', f.gerant || f.signataire || vide],
      ['SIRET', vide],
      ['Téléphone / e-mail', [f.tel, f.email].filter(Boolean).join(' · ') || vide],
      ['Stock fixe (sans rotation)', f.capacite ? `${f.capacite} climatiseur${f.capacite > 1 ? 's' : ''} (modifiable d’un commun accord)` : '____ climatiseurs'],
      ['Mise en service', 'Dépose du 10 au 15 mai 2027'],
    ]);
    doc.y = Math.max(yA, yB) + 6;
    doc.strokeColor(TRAIT).lineWidth(0.8).rect(M, y0, W, doc.y - y0).stroke();

    // 2. L'essentiel
    titre(doc, '2. L’essentiel en un coup d’œil');
    for (const [k, v] of ESSENTIEL) {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(ENCRE).text(k, M, y, { width: 120 });
      const yk = doc.y;
      doc.font('Helvetica').fontSize(9.5).fillColor(ENCRE).text(v, M + 130, y, { width: W - 130 });
      doc.y = Math.max(yk, doc.y) + 4;
      doc.strokeColor(TRAIT).lineWidth(0.5).moveTo(M, doc.y - 2).lineTo(M + W, doc.y - 2).stroke();
    }

    // 3. Articles
    titre(doc, '3. Articles de la convention');
    for (const [t, puces] of ARTICLES) {
      if (doc.y > 720) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(ENCRE).text(t, M, doc.y, { width: W });
      doc.moveDown(0.25);
      for (const p of puces) {
        if (doc.y > 760) doc.addPage();
        const y = doc.y;
        doc.font('Helvetica').fontSize(9.5).fillColor(BLEU).text('•', M + 4, y);
        doc.font('Helvetica').fontSize(9.5).fillColor(ENCRE).text(p, M + 16, y, { width: W - 16, lineGap: 1 });
        doc.moveDown(0.2);
      }
      doc.moveDown(0.3);
    }

    // 4. Signatures
    if (doc.y > 600) doc.addPage();
    titre(doc, '4. Signatures');
    const ys = doc.y, h = 150;
    doc.strokeColor(TRAIT).lineWidth(0.8).rect(M, ys, colW, h).stroke().rect(M + colW + 16, ys, colW, h).stroke();
    const sig = (x, lignes) => {
      let y = ys + 10;
      for (const l of lignes) { doc.font(l[1] ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(ENCRE).text(l[0], x + 10, y, { width: colW - 20 }); y = doc.y + 2; }
      return y;
    };
    sig(M, [['LOC’AIR', true], ['Lu et approuvé — Bon pour accord'], ['Aly THIAM, Gérant'], [signe ? `Nice, le ${frDate(f.signe_at)}` : 'Nice, le ____/____/20____']]);
    const yp = sig(M + colW + 16, [['PARTENAIRE', true], ['Lu et approuvé — Bon pour accord'], [f.signataire || 'Nom & qualité : ______________________'], [signe ? `Signé électroniquement le ${frDate(f.signe_at)} à ${frHeure(f.signe_at)}` : 'Lieu & date : ______________, le ____/____/20____']]);
    if (signe) {
      try { doc.image(signaturePng, M + colW + 26, yp + 2, { fit: [colW - 40, ys + h - yp - 10] }); } catch (_e) { /* image illisible : la mention suffit */ }
    } else {
      doc.font('Helvetica').fontSize(9).fillColor(GRIS).text('Signature & cachet :', M + colW + 26, yp + 6);
    }
    doc.y = ys + h + 10;
    doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(
      signe
        ? `Convention signée électroniquement sur locair.fr/partenaires (signature tracée à l’écran, horodatée ; référence de la fiche : ${f.id || '—'}). Une copie est envoyée par e-mail au partenaire.`
        : 'À signer sur l’écran (lien reçu par e-mail) ou en deux exemplaires papier. Une question : partenaires.locair@outlook.com · 06 63 79 87 56.',
      M, doc.y, { width: W });
    doc.end();
  });
}

module.exports = { generateConventionPdf };
