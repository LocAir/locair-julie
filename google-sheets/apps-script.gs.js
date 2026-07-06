/**
 * Loc'Air — journal centralisé des réservations (Google Sheets)
 *
 * À COPIER dans l'éditeur Apps Script lié à la Google Sheet (Extensions > Apps Script),
 * PAS dans ce dépôt côté serveur. Conservé ici uniquement comme référence versionnée.
 *
 * Reçoit en POST (JSON) les événements envoyés par :
 *  - index.html            → demandes de rappel (mode "call")
 *  - api/webhook.js        → réservations payées, prolongations, retards (mode "pay")
 * et ajoute une ligne à l'onglet "Réservations".
 *
 * Colonnes (dans l'ordre) :
 * Horodatage | Type | Statut | Réf. dossier | Prénom | Nom | Téléphone | Email | Adresse |
 * Durée (jours) | Jours supplémentaires | Jours totaux | Date livraison | Créneau |
 * Date récupération | Installation | Étage | Ascenseur | Fenêtre | Quantité | Code promo |
 * Montant | Stripe Payment Intent ID | Stripe Customer ID | Moyen de paiement | Notes
 */

var SHEET_NAME = 'Réservations';

var COLUMNS = [
  'type', 'statut', 'ref', 'prenom', 'nom', 'tel', 'email', 'adresse',
  'duree', 'jours_supp', 'jours_totaux', 'date_livraison', 'creneau',
  'date_recuperation', 'installation', 'etage', 'ascenseur', 'fenetre',
  'quantite', 'promo', 'montant', 'stripe_id', 'customer_id',
  'payment_method', 'notes',
];

function doPost(e) {
  var out = ContentService.createTextOutput().setMimeType(ContentService.MimeType.JSON);

  var data;
  try {
    data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return out.setContent(JSON.stringify({ ok: false, error: 'JSON invalide' }));
  }

  var sheet = getOrCreateSheet_();
  var tz = Session.getScriptTimeZone() || 'Europe/Paris';
  var horodatage = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm:ss');

  var row = [horodatage];
  for (var i = 0; i < COLUMNS.length; i++) {
    row.push(data[COLUMNS[i]] || '');
  }
  sheet.appendRow(row);

  return out.setContent(JSON.stringify({ ok: true }));
}

function getOrCreateSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SHEET_NAME);
  var headers = [
    'Horodatage', 'Type', 'Statut', 'Réf. dossier', 'Prénom', 'Nom', 'Téléphone', 'Email',
    'Adresse', 'Durée (jours)', 'Jours supplémentaires', 'Jours totaux', 'Date livraison',
    'Créneau', 'Date récupération', 'Installation', 'Étage', 'Ascenseur', 'Fenêtre',
    'Quantité', 'Code promo', 'Montant', 'Stripe Payment Intent ID', 'Stripe Customer ID',
    'Moyen de paiement', 'Notes',
  ];
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1b3a5f').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  return sheet;
}

/** Menu manuel pour retester le webhook depuis l'éditeur (Extensions > Apps Script > Exécuter > test). */
function test() {
  doPost({
    postData: {
      contents: JSON.stringify({
        type: 'Réservation', statut: '✅ Stripe confirmé — 175.00 €', ref: 'TEST-0001',
        prenom: 'Jean', nom: 'Dupont', tel: '0600000000', email: 'test@example.com',
        adresse: '10 rue de Test, Nice', duree: '7', date_livraison: '2026-07-10',
        creneau: '8h–10h', installation: 'Autonome', montant: '175.00 €',
      }),
    },
  });
}
