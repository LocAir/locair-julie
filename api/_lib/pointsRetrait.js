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
//   commission_pct   commission du commerçant sur la location payée (15 %,
//             décidé par le propriétaire le 18/11/2026)
//   zone      'cote-azur' ou 'madrid' (page et langue)
const STOCK_PAR_DEFAUT = 4;
const COMMISSION_POINT_PCT = 15;
const POINTS_RETRAIT = [
  { id: 'nice-centre',      ville: 'Nice',                 nom: 'Nice Centre',          lat: 43.7009, lng: 7.2683, adresse: 'Adresse à venir, 06000 Nice',                 horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 60,  exemple: true },
  { id: 'nice-port',        ville: 'Nice',                 nom: 'Nice Port',            lat: 43.6966, lng: 7.2852, adresse: 'Adresse à venir, 06300 Nice',                 horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 60,  exemple: true },
  { id: 'nice-ouest',       ville: 'Nice',                 nom: 'Nice Ouest',           lat: 43.6845, lng: 7.2010, adresse: 'Adresse à venir, 06200 Nice',                 horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 60,  exemple: true },
  { id: 'saint-laurent',    ville: 'Saint-Laurent-du-Var', nom: 'Saint-Laurent-du-Var', lat: 43.6731, lng: 7.1907, adresse: 'Adresse à venir, 06700 Saint-Laurent-du-Var', horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 60,  exemple: true },
  { id: 'cagnes',           ville: 'Cagnes-sur-Mer',       nom: 'Cagnes-sur-Mer',       lat: 43.6644, lng: 7.1489, adresse: 'Adresse à venir, 06800 Cagnes-sur-Mer',       horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 60,  exemple: true },
  { id: 'antibes',          ville: 'Antibes',              nom: 'Antibes',              lat: 43.5804, lng: 7.1251, adresse: 'Adresse à venir, 06600 Antibes',              horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 120, exemple: true },
  { id: 'juan-les-pins',    ville: 'Antibes',              nom: 'Juan-les-Pins',        lat: 43.5684, lng: 7.1110, adresse: 'Adresse à venir, 06160 Juan-les-Pins',        horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 120, exemple: true },
  { id: 'cannes',           ville: 'Cannes',               nom: 'Cannes',               lat: 43.5528, lng: 7.0174, adresse: 'Adresse à venir, 06400 Cannes',               horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 120, exemple: true },
  { id: 'grasse',           ville: 'Grasse',               nom: 'Grasse',               lat: 43.6584, lng: 6.9225, adresse: 'Adresse à venir, 06130 Grasse',               horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 120, exemple: true },
  { id: 'villefranche',     ville: 'Villefranche-sur-Mer', nom: 'Villefranche-sur-Mer', lat: 43.7040, lng: 7.3111, adresse: 'Adresse à venir, 06230 Villefranche-sur-Mer', horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 120, exemple: true },
  { id: 'beausoleil',       ville: 'Beausoleil',           nom: 'Beausoleil (Monaco)',  lat: 43.7429, lng: 7.4236, adresse: 'Adresse à venir, 06240 Beausoleil',           horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 120, exemple: true },
  { id: 'menton',           ville: 'Menton',               nom: 'Menton',               lat: 43.7747, lng: 7.4975, adresse: 'Adresse à venir, 06500 Menton',               horaires: 'Lun–Sam · 9h–19h', fermes: [0], livraison: 120, exemple: true },
];

// Valeurs par défaut posées une seule fois : chaque point a toujours un
// stock, une commission et une zone, même si la ligne ne les écrit pas.
POINTS_RETRAIT.forEach((p) => {
  if (!Number.isFinite(p.stock)) p.stock = STOCK_PAR_DEFAUT;
  if (!Number.isFinite(p.commission_pct)) p.commission_pct = COMMISSION_POINT_PCT;
  if (!p.zone) p.zone = 'cote-azur';
  if (!('partenaire_code' in p)) p.partenaire_code = null;
});

function getPointRetrait(id) {
  return POINTS_RETRAIT.find((p) => p.id === id) || null;
}

// Les points d'une même ville forment un « cluster » : c'est sur lui qu'on
// mesure le taux d'occupation pour le prix fort.
function pointsDuCluster(point) {
  return POINTS_RETRAIT.filter((p) => p.zone === point.zone && p.ville === point.ville);
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

module.exports = { POINTS_RETRAIT, getPointRetrait, pointsDuCluster, codePostalDuPoint, pointFermeLe, STOCK_PAR_DEFAUT, COMMISSION_POINT_PCT };
