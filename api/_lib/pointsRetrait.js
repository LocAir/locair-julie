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
//   ouverture       1er jour où un client peut retirer (lendemain de la dépose)
//   fin_saison      dernier jour de la saison (MM-JJ) : retour au plus tard ce jour-là
//   prix_jour       prix moyen repère par jour (haut / bas) pour le point mort
//   pub_jour        budget pub par jour, lancé à la dépose
const CELLULES = [
  { id: 'c1', nom: 'Cellule 1 · Nice–Cannes', flotte: 40, charges: { box: 165, agent: 700, pub: 600 }, mois_saison: 4, jours_saison: 120,
    depose: ['05-10', '05-15'], ouverture: '05-16', fin_saison: '09-30', prix_jour: { haut: 23.43, bas: 19.86 }, pub_jour: 20 },
];
// Point mort d'une cellule en jours-machine : charges de la saison ÷ marge
// par jour après les 20 % du commerçant (playbook : 313 à 369 pour la Cellule 1).
function pointMortCellule(c, commissionPct) {
  const charges = (c.charges.box + c.charges.agent + c.charges.pub) * c.mois_saison;
  const net = (p) => p * (1 - (commissionPct == null ? 20 : commissionPct) / 100);
  return { charges_saison: charges, min: Math.round(charges / net(c.prix_jour.haut)), max: Math.round(charges / net(c.prix_jour.bas)) };
}
function getCellule(id) { return CELLULES.find((c) => c.id === id) || CELLULES[0]; }
// Saison du point (playbook : climatiseurs déposés du 10 au 15 mai, repris
// fin septembre) : une location Click & Collect doit tenir entre l'ouverture
// et la fin de saison de SA cellule, la même année. Le point de test est
// ouvert toute l'année (essais du propriétaire). Renvoie null si c'est bon,
// sinon un message pour le client.
const MOIS_TXT = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const jourTxt = (mmjj) => { const [m, j] = mmjj.split('-').map(Number); return `${j === 1 ? '1er' : j} ${MOIS_TXT[m - 1]}`; };
function horsSaison(point, debut, fin) {
  if (!point || point.test) return null;
  const c = getCellule(point.cellule), y = String(debut || '').slice(0, 4);
  const ouv = c.ouverture || '05-16', finS = c.fin_saison || '09-30';
  if (debut >= `${y}-${ouv}` && (!fin || fin <= `${y}-${finS}`)) return null;
  return `Le Click & Collect est ouvert du ${jourTxt(ouv)} au ${jourTxt(finS)} (retour au plus tard le ${jourTxt(finS)}).`;
}

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

// Valeurs par défaut : chaque point a toujours un stock, une commission et
// une zone, même si la ligne ne les écrit pas.
function normaliser(p) {
  if (!Number.isFinite(p.stock)) p.stock = STOCK_PAR_DEFAUT;
  p.stock_code = p.stock; // valeur de départ ; l'admin peut la changer (_lib/stockPoints.js)
  if (!Number.isFinite(p.commission_pct)) p.commission_pct = COMMISSION_POINT_PCT;
  if (!p.zone) p.zone = 'cote-azur';
  if (!p.cellule) p.cellule = 'c1'; // tous les points actuels : Cellule 1 (Nice–Cannes)
  if (!Array.isArray(p.ouverture)) p.ouverture = [9, 19];
  if (!('partenaire_code' in p)) p.partenaire_code = null;
  if (!Array.isArray(p.photos)) p.photos = [];
  return p;
}
POINTS_RETRAIT.forEach(normaliser);

// ── Points créés ou modifiés depuis l'admin (26/11/2026) ─────────────────
// Table points_retrait (une ligne = un point, champs dans `data`). Même id
// qu'un point du code = le remplace (ex. l'exemple « Nice Port » devient la
// vraie boutique). La liste est relue au plus toutes les 60 s ; table
// absente ou illisible = la liste du code, rien ne casse. Les fonctions
// ci-dessous restent synchrones : chaque fonction api/ appelle
// chargerPoints() au début, et POINTS_RETRAIT est mis à jour sur place.
const IDS_CODE = new Set(POINTS_RETRAIT.map((p) => p.id));
const CHAMPS_ADMIN = ['nom', 'ville', 'adresse', 'lat', 'lng', 'horaires', 'ouverture', 'fermes', 'stock', 'tel', 'partenaire_code', 'exemple', 'livraison', 'cellule', 'photos'];
const DUREE_CACHE_MS = 60 * 1000;
let _lu = 0, _enCours = null;
// On ne touche qu'aux points qui ont une ligne dans la table : avant chaque
// lecture, on défait la précédente (valeurs du code remises, points ajoutés
// retirés), puis on applique la nouvelle. Table vide = rien ne bouge.
let _defaire = { valeurs: [], ajoutes: [] }, _signature = '[]';
function appliquerPoints(lignes) {
  const sig = JSON.stringify((lignes || []).map((l) => [l.id, l.actif, l.data]));
  if (sig === _signature) return;
  _signature = sig;
  // 1. défaire la lecture précédente
  for (const [o, k, existait, v] of _defaire.valeurs.reverse()) { if (existait) o[k] = v; else delete o[k]; }
  for (const id of _defaire.ajoutes) { const i = POINTS_RETRAIT.findIndex((p) => p.id === id); if (i >= 0) POINTS_RETRAIT.splice(i, 1); }
  _defaire = { valeurs: [], ajoutes: [] };
  const poser = (o, k, v) => { _defaire.valeurs.push([o, k, k in o, o[k]]); o[k] = v; };
  // 2. appliquer la nouvelle
  for (const l of lignes || []) {
    const d = l.data || {};
    const o = POINTS_RETRAIT.find((p) => p.id === l.id);
    if (o && estDuCode(l.id)) {
      if (o.test) continue;
      CHAMPS_ADMIN.forEach((k) => { if (k in d) poser(o, k, d[k]); });
      if ('stock' in d) poser(o, 'stock_code', o.stock);
      poser(o, 'cree_admin', true);
      continue;
    }
    if (l.actif === false || o) continue;
    const v = { id: l.id, cree_admin: true };
    CHAMPS_ADMIN.forEach((k) => { if (k in d) v[k] = JSON.parse(JSON.stringify(d[k])); });
    normaliser(v);
    v.stock_code = v.stock;
    POINTS_RETRAIT.push(v);
    _defaire.ajoutes.push(v.id);
  }
  try { require('./stockPoints').reappliquerStocks(); } catch (_e) { /* pas encore chargé */ }
}
function estDuCode(id) { return IDS_CODE.has(id); }
async function chargerPoints(supabase, { force } = {}) {
  if (!force && Date.now() - _lu < DUREE_CACHE_MS) return;
  if (_enCours && !force) return _enCours;
  _enCours = (async () => {
    try {
      const sb = supabase || require('./supabase').getSupabase();
      const { data, error } = await sb.from('points_retrait').select('id, data, actif');
      if (error) throw error;
      appliquerPoints(data || []);
    } catch (_e) { /* table absente : liste du code */ }
    _lu = Date.now();
    _enCours = null;
  })();
  return _enCours;
}

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

module.exports = { chargerPoints, estDuCode, appliquerPoints, CHAMPS_ADMIN, CELLULES, getCellule, pointMortCellule, horsSaison, pointDuPartenaire, tauxAffiche, POINTS_RETRAIT, getPointRetrait, pointsDuCluster, codePostalDuPoint, pointFermeLe, STOCK_PAR_DEFAUT, COMMISSION_POINT_PCT };
