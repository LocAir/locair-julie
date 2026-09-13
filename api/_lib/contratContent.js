// Contenu texte du contrat de location — extrait de _lib/pdf.js
// (generateContratPdf) pour servir de SOURCE UNIQUE à deux usages :
//   1. le PDF envoyé par email à la confirmation (_lib/pdf.js) ;
//   2. l'aperçu affiché en direct sur le téléphone du livreur au moment de
//      faire signer le client (action 'contrat_texte', transporteur-action.js).
// Sans ce module partagé, les deux auraient fini par diverger avec le temps
// (un article corrigé d'un côté, oublié de l'autre) — inacceptable pour un
// texte à valeur contractuelle. Ne contient QUE le texte (articles, récap) —
// aucune mise en page : chaque consommateur affiche ces mêmes données à sa
// façon (dessin PDFKit ici, HTML là-bas).
const { SELLER } = require('./legal');
const { DEFAULT_PRICING_CONFIG } = require('./pricing');

function fmtDate(d) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function eur(cents) {
  return (Math.round(cents || 0) / 100).toFixed(2).replace('.', ',') + ' €';
}

// Garde contre dates null/undefined (même filet que _lib/pdf.js, audit
// 2026-08-06 I12) : new Date(undefined) → NaN → "NaN jours" affiché au client.
function nbJours(dateDebut, dateFin) {
  if (!dateDebut || !dateFin) return 1;
  const d1 = new Date(dateDebut + 'T00:00:00Z');
  const d2 = new Date(dateFin   + 'T00:00:00Z');
  const diff = Math.round((d2 - d1) / 86400000);
  return Math.max(1, isNaN(diff) ? 1 : diff);
}

function modeleLabel(appareils) {
  const a = appareils && appareils[0];
  if (a && a.modele) {
    const m = a.modele;
    return `${m.marque || ''} ${m.modele || ''}`.trim() || 'Climatiseur mobile';
  }
  return 'Rowenta RWAC10KA ou FRICO CLIMOB 12 (9 000 à 12 000 BTU)';
}

// { reservation, appareils, pricing, forfait } → { locataireNom, entreprise,
// modele, jours, recap: [{label,value}], articles: [{num,titre,texte}] }
function buildContratContent({ reservation, appareils, pricing, forfait }) {
  const p = pricing || DEFAULT_PRICING_CONFIG;
  const jours  = nbJours(reservation.date_debut, reservation.date_fin);
  const modele = modeleLabel(appareils);
  const entreprise = reservation.type_client === 'entreprise' && reservation.raison_sociale
    ? ` (${reservation.raison_sociale}${reservation.siret ? ', SIRET ' + reservation.siret : ''})` : '';
  const locataireNom = `${reservation.prenom || ''} ${reservation.nom || ''}`.trim();
  const modeleConnu = !!(appareils && appareils[0] && appareils[0].modele);

  const recap = [
    { label: 'Équipement',            value: modele },
    { label: 'Période',               value: `Du ${fmtDate(reservation.date_debut)} au ${fmtDate(reservation.date_fin)} — ${jours} jours` },
    { label: 'Adresse de livraison',  value: reservation.adresse || '—' },
    { label: 'Installation',          value: reservation.installation || 'Kit autonome sans perçage (gratuit)' },
  ];

  const articles = [
    { num: 1, titre: 'Parties',
      texte: `Bailleur : ${SELLER.nomCommercial}, exploité par Aly THIAM, ${SELLER.adresse}. SIRET : ${SELLER.siret}.\n` +
             `Locataire : ${locataireNom}${entreprise}, demeurant au ${reservation.adresse || '—'}.` },

    { num: 2, titre: 'Objet',
      texte: modeleConnu
        ? `Location d’un climatiseur mobile ${modele} (de 9 000 à 12 000 BTU, adapté aux espaces jusqu’à 20 m²) ` +
          `avec kit d’installation complet (gaine, télécommande, kit de calfeutrage sans perçage).`
        : `Location d’un climatiseur mobile (Rowenta RWAC10KA ou FRICO CLIMOB 12, de 9 000 à 12 000 BTU, ` +
          `adapté aux espaces jusqu’à 20 m²) avec kit d’installation complet (gaine, télécommande, kit de calfeutrage sans perçage).` },

    { num: 3, titre: 'Durée',
      texte: `La durée minimale de location est de ${p.duree_min_jours} jours. La location débute le ${fmtDate(reservation.date_debut)} et se termine le ` +
             `${fmtDate(reservation.date_fin)}, pour une durée de ${jours} jours.` },

    // Un forfait (ex. "Pack Sérénité") a un prix total fixe, sans aucun
    // rapport avec le barème dégressif normal — décrire ce dernier ici
    // serait faux et trompeur pour le locataire (et pour Aly en cas de
    // relecture). Le forfait garde sa description propre.
    { num: 4, titre: 'Tarification & livraison',
      texte: forfait
        ? `Cette location fait l'objet d'un forfait à prix fixe : « ${forfait.nom} », ${forfait.quantite} climatiseur${forfait.quantite > 1 ? 's' : ''} sur ${forfait.duree_jours} jours, pour un prix total de ${eur(forfait.prix_cents)} (hors livraison et installation).\n` +
          'Frais de livraison et récupération : 60,00 € (Nice, Saint-Laurent-du-Var, Cagnes-sur-Mer, Villefranche-sur-Mer, ' +
          'Beaulieu-sur-Mer) ou 120,00 € (hors zone).\n' +
          'Option installation par un technicien qualifié : 80,00 € (en option) ou installation en autonomie (gratuite, kit fourni sans perçage).\n' +
          `TVA : ${SELLER.mentionTva}.`
        : `Tarif journalier (TTC) : ${eur(p.palier1_tarif_cents)}/jour (${p.palier1_max_jours} jours) · ${eur(p.palier2_tarif_cents)}/jour (${p.palier1_max_jours + 1} à ${p.palier2_max_jours} jours) · ` +
          `${eur(p.palier3_tarif_cents)}/jour (${p.palier2_max_jours + 1} à ${p.palier3_max_jours} jours) · ${eur(p.palier4_tarif_cents)}/jour (${p.palier3_max_jours + 1} jours et plus). Durée minimale : ${p.duree_min_jours} jours.\n` +
          'Frais de livraison et récupération : 60,00 € (Nice, Saint-Laurent-du-Var, Cagnes-sur-Mer, Villefranche-sur-Mer, ' +
          'Beaulieu-sur-Mer) ou 120,00 € (hors zone).\n' +
          'Option installation par un technicien qualifié : 80,00 € (en option) ou installation en autonomie (gratuite, kit fourni sans perçage).\n' +
          `TVA : ${SELLER.mentionTva}.` },

    { num: 5, titre: 'Modalités de paiement & autorisation',
      texte: reservation.stripe_payment_intent_id
        ? `Le paiement est exigé à la réservation via la solution de paiement sécurisée Stripe. Aucun dépôt de garantie n’est demandé.\n` +
          `Le locataire autorise expressément ${SELLER.nomCommercial} à enregistrer sa carte bancaire de façon sécurisée via Stripe afin de ` +
          `permettre un prélèvement de plein droit en cas de retard de restitution, selon les tarifs de l’article 10 bis des CGV.`
        : `Le paiement est exigé à la réservation. Aucun dépôt de garantie n’est demandé.\n` +
          `Le locataire autorise expressément ${SELLER.nomCommercial} à procéder à un prélèvement de plein droit en cas de retard de restitution, selon les tarifs de l’article 10 bis des CGV.` },

    { num: 6, titre: 'Conditions générales & annulation',
      texte: 'Annulation : remboursement intégral pour toute annulation effectuée avant la livraison (prise de contact avant 20h la veille de ' +
             'la livraison prévue). Passé ce délai, aucun remboursement n’est accordé.\n' +
             'Garantie panne : en cas de défaillance technique non imputable au client, l’appareil est dépanné ou remplacé dans les meilleurs ' +
             'délais. À défaut, les jours de location restants sont intégralement remboursés.\n' +
             'Responsabilité : le locataire est responsable de l’utilisation normale de l’appareil conformément aux instructions. Il s’engage ' +
             'à ne pas le déplacer ou tenter de le réparer sans accord préalable.\n' +
             'Rétractation : en signant ce contrat et en demandant la livraison, le locataire renonce expressément à son droit de rétractation ' +
             'de 14 jours pour permettre le début immédiat de la prestation.' },

    { num: 7, titre: 'Litiges & médiation',
      texte: 'Contrat soumis au droit français. En cas de litige non résolu à l’amiable, le locataire peut recourir gratuitement au médiateur ' +
             'de la consommation MEDICYS (73 Boulevard de Clichy, 75009 Paris — www.medicys.fr). À défaut, les tribunaux compétents sont ceux de Nice.' },
  ];

  return { locataireNom, entreprise, modele, jours, modeleConnu, recap, articles };
}

module.exports = { buildContratContent, fmtDate, eur, nbJours, modeleLabel };
