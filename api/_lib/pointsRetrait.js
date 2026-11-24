// Points de retrait Click & Collect — LA SEULE LISTE.
// La page /click-and-collect la lit via /api/points-retrait, et le paiement
// (api/checkout-click-collect.js) la relit pour vérifier le point choisi :
// un point inventé ou modifié par le navigateur est refusé.
//
// ⚠ EXEMPLES. Tant qu'un point a exemple:true, il s'affiche (pastille
// « Exemple ») mais le PAIEMENT EN LIGNE Y EST REFUSÉ : un vrai client ne
// doit jamais payer pour un point qui n'existe pas.
//
// Champs :
//   id        identifiant court, stable (sert au paiement et aux emails)
//   ville     regroupement affiché sur la page
//   nom       nom affiché
//   adresse   adresse complète, avec le code postal (sert aussi à
//             retrouver la ville Loc'Air et vérifier le stock)
//   horaires  texte affiché
//   fermes    jours fermés (0 = dimanche … 6 = samedi), barrés au calendrier
//   lat, lng  position sur la carte (clic droit sur Google Maps)
//   livraison prix de la livraison à domicile dans cette ville, affiché barré
//   exemple   true = point fictif, paiement refusé
//   stock     appareils déposés au point pour la saison (stock figé, 4 par
//             défaut) : au-delà, le point refuse de nouvelles réservations
//             sur les mêmes dates
//   partenaire_code  code du commerçant dans l'admin (onglet Partenaires) :
//             la réservation lui est rattachée et sa commission comptée
//   commission_pct   commission du commerçant sur la location payée (20 %,
//             décidé par le propriétaire le 21/11/2026 ; 15 % avant)
//   tel       téléphone de la boutique (affiché au besoin)
//   zone      'cote-azur' ou 'madrid' (page et langue)
//   ouverture [heure d'ouverture, heure de fermeture] des jours ouverts,
//             à l'heure de Paris (affiche « Ouvert · ferme à 19h »)
//   photos    jusqu'à 2 photos du point, dans cet ordre : la devanture vue de
//             la rue, puis le comptoir / l'intérieur. Fichiers .webp à poser
//             dans /points/ (ex. ['/points/nice-port-1.webp',
//             '/points/nice-port-2.webp']). Prises par le propriétaire ou le
//             commerçant, AVEC SON ACCORD — jamais de photo Google Maps.
//             Vide = rien ne change à l'écran.
// ── CELLULES (playbook Cellule 1 V3 + présentation investisseurs V2) ──
// Une cellule = un blueprint reproductible : une flotte (40 climatiseurs),
// 8 à 10 commerces, 1 micro-box (stock de secours), sa pub et son agent.
// Ouvrir une nouvelle cellule = ajouter UNE ligne ici, puis donner son id
// (champ « cellule ») aux points qui en font partie. L'admin (Points de
// retrait) affiche alors une carte par cellule et se filtre dessus.
//   flotte          climatiseurs de la cellule (points + micro-box)
//   charges         €/mois pendant la saison : box, agent d'entretien, pub
//   mois_saison     durée de la saison active (fin mai → fin septembre ≈ 4)
//   jours_saison    jours actifs (120) → capacité = flotte × jours_saison
//   depose          [début, fin] de la dépose chez les commerçants (MM-JJ)
//   fin_saison      dernier jour de la saison (MM-JJ)
//   prix_jour       prix moyen repère par jour (haut / bas) pour le point mort
//   pub_jour        budget pub par jour, lancé à la dépose
const CELLULES = [
  { id: 'c1', nom: 'Cellule 1 · Nice–Cannes', flotte: 40, charges: { box: 165, agent: 700, pub: 600 }, mois_saison: 4, jours_saison: 120,
    depose: ['05-10', '05-15'], fin_saison: '09-30', prix_jour: { haut: 23.43, bas: 19.86 }, pub_jour: 20 },
];
// Point mort d'une cellule en jours-machine : charges de la saison ÷ marge
// par jour après les 20 % du commerçant (playbook : 313 à 369 pour la Cellule 1).
function pointMortCellule(c, commissionPct) {
  const charges = (c.charges.box + c.charges.agent + c.charges.pub) * c.mois_saison;
  const net = (p) => p * (1 - (commissionPct == null ? 20 : commissionPct) / 100);
  return { charges_saison: charges, min: Math.round(charges / net(c.prix_jour.haut)), max: Math.round(charges / net(c.prix_jour.bas)) };
}
function getCellule(id) { return CELLULES.find((c) => c.id === id) || CELLULES[0]; }

const STOCK_PAR_DEFAUT = 4;
const COMMISSION_POINT_PCT = 20;
// Cellule 1 (playbook V3, 24/11/2026) : l'axe Nice–Cannes seulement, 8 à 10 points.
const POINTS_RETRAIT = [
  // POINT DE TEST (propriétaire) : invisible pour les clients, visible
  // seulement sur /click-and-collect?test=1. Sert à faire un vrai paiement
  // de bout en bout (puis le rembourser dans Stripe) avant la 1re boutique.
  // Jamais compté dans le stock, le prix ou la carte des vrais points.
  { id: 'test-locair', ville: 'Nice', nom: 'Point test Loc’Air', lat: 43.7031, lng: 7.2661, adresse: 'Point de test — ne pas utiliser, 06000 Nice', horaires: 'Tous les jours · 0h–24h', fermes: [], ouverture: [0, 24], stock: 1, exemple: false, test: true, tel: '04 00 00 00 00' },
  { id: 'nice-centre',      ville: 'Nice',                 nom: 'Nice Centre',          lat: 43.7009, lng: 7.2683, adresse: 'Adresse à venir, 06000 Nice',                 horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 60,  exemple: true },
  { id: 'nice-port',        ville: 'Nice',                 nom: 'Nice Port',            lat: 43.6966, lng: 7.2852, adresse: 'Adresse à venir, 06300 Nice',                 horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 60,  exemple: true },
  { id: 'nice-ouest',       ville: 'Nice',                 nom: 'Nice Ouest',           lat: 43.6845, lng: 7.2010, adresse: 'Adresse à venir, 06200 Nice',                 horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 60,  exemple: true },
  { id: 'saint-laurent',    ville: 'Saint-Laurent-du-Var', nom: 'Saint-Laurent-du-Var', lat: 43.6731, lng: 7.1907, adresse: 'Adresse à venir, 06700 Saint-Laurent-du-Var', horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 60,  exemple: true },
  { id: 'cagnes',           ville: 'Cagnes-sur-Mer',       nom: 'Cagnes-sur-Mer',       lat: 43.6644, lng: 7.1489, adresse: 'Adresse à venir, 06800 Cagnes-sur-Mer',       horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 60,  exemple: true },
  { id: 'antibes',          ville: 'Antibes',              nom: 'Antibes',              lat: 43.5804, lng: 7.1251, adresse: 'Adresse à venir, 06600 Antibes',              horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 120, exemple: true },
  { id: 'juan-les-pins',    ville: 'Antibes',              nom: 'Juan-les-Pins',        lat: 43.5684, lng: 7.1110, adresse: 'Adresse à venir, 06160 Juan-les-Pins',        horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 120, exemple: true },
  { id: 'cannes',           ville: 'Cannes',               nom: 'Cannes',               lat: 43.5528, lng: 7.0174, adresse: 'Adresse à venir, 06400 Cannes',               horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 120, exemple: true },
];

// Valeurs par défaut posées une seule fois : chaque point a toujours un
// stock, une commission et une zone, même si la ligne ne les écrit pas.
POINTS_RETRAIT.forEach((p) => {
  if (!Number.isFinite(p.stock)) p.stock = STOCK_PAR_DEFAUT;
  if (!Number.isFinite(p.commission_pct)) p.commission_pct = COMMISSION_POINT_PCT;
  if (!p.zone) p.zone = 'cote-azur';
  if (!p.cellule) p.cellule = 'c1'; // tous les points actuels : Cellule 1 (Nice–Cannes)
  if (!Array.isArray(p.ouverture)) p.ouverture = [9, 19];
  if (!('partenaire_code' in p)) p.partenaire_code = null;
  if (!Array.isArray(p.photos)) p.photos = [];
});

function getPointRetrait(id) {
  return POINTS_RETRAIT.find((p) => p.id === id) || null;
}

// Les points d'une même ville forment un « cluster » : c'est sur lui qu'on
// mesure le taux d'occupation pour le prix fort.
function pointsDuCluster(point) {
  if (point.test) return [point]; // le point de test vit à part
  return POINTS_RETRAIT.filter((p) => !p.test && p.zone === point.zone && p.ville === point.ville);
}

function codePostalDuPoint(point) {
  const m = String(point && point.adresse || '').match(/\b(\d{5})\b/);
  return m ? m[1] : '';
}

// Jour de la semaine (0 = dimanche) d'une date AAAA-MM-JJ, sans fuseau.
function jourSemaine(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function pointFermeLe(point, iso) {
  return (point.fermes || []).includes(jourSemaine(iso));
}

// Point de retrait d'un commerçant (par son code partenaire), ou null.
function pointDuPartenaire(code) {
  if (!code) return null;
  const c = String(code).toLowerCase();
  return POINTS_RETRAIT.find((p) => !p.test && p.partenaire_code && String(p.partenaire_code).toLowerCase() === c) || null;
}
// Taux affiché au partenaire : celui du point s'il est commerçant point de
// retrait (20 %), sinon celui de sa fiche dans l'admin (apporteur d'affaires).
function tauxAffiche(partenaire) {
  const pt = partenaire && pointDuPartenaire(partenaire.code);
  return pt ? pt.commission_pct : (partenaire ? partenaire.taux_commission_pct ?? null : null);
}

module.exports = { CELLULES, getCellule, pointMortCellule, pointDuPartenaire, tauxAffiche, POINTS_RETRAIT, getPointRetrait, pointsDuCluster, codePostalDuPoint, pointFermeLe, STOCK_PAR_DEFAUT, COMMISSION_POINT_PCT };
