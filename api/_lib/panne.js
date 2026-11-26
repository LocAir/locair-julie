// UNE SEULE RÈGLE DE PANNE pour tous les canaux (décision du propriétaire,
// 21/11/2026) : page /panne (client chez lui), comptoir /retrait (retrait,
// échange en cours de location, retour). Chaque déclaration :
//   1. crée un TICKET ADMIN (table incidents, statut « nouveau ») ;
//   2. décide toute seule de la suite (aucune action d'Aly nécessaire) ;
//   3. crée au besoin une mission « Remplacement » (livraisons, type
//      'changement') reliée au ticket : mission faite = ticket fermé.
//
// Les suites possibles (champ `issue`) :
//   JAMAIS de transporteur chez le client pour une panne (décision du
//   propriétaire, 21/11/2026) : un client livré à domicile rapporte lui
//   aussi l'appareil au point Click & Collect le plus proche.
//   'echange_comptoir'    Click & Collect, il reste un appareil au point :
//                         le commerçant en donne un autre tout de suite.
//   'rapporter_au_point'  Click & Collect, panne chez soi, il reste un
//                         appareil au point : le client le rapporte et repart
//                         avec un autre (aucun trajet transporteur urgent).
//   'reapprovisionnement' Click & Collect, plus d'appareil au point : mission
//                         URGENTE pour apporter un appareil ; SMS au client
//                         quand il l'attend (voir transporteur-action.js).
//   'ticket'              « Autre », ou appareil abîmé constaté au retour :
//                         ticket admin, et reprise sans urgence au point.
//
// À grande échelle : les appareils abîmés laissés à un point ne déclenchent
// PAS un trajet chacun. Leur reprise est calée sur la prochaine mission déjà
// prévue à ce point (même jour, même adresse : un seul passage), sinon le
// lendemain. Les missions urgentes sont réservées aux clients sans appareil.
const { pickTransporteurForMission } = require('./reservations');
const { notifyTransporteur } = require('./transporteurNotif');
const { pushToAdmin } = require('./push');
const { todayParis, heureParis, addDays } = require('./dates');
const { occupationParPoint } = require('./clickCollect');
const { STOCK_PAR_DEFAUT, POINTS_RETRAIT, horsSaison } = require('./pointsRetrait');
const { extractPostalCode } = require('./postal');
const { INCIDENT_OPEN_STATUSES } = require('./incidentStatus');

const OUVERTS = ['a_faire', 'acceptee', 'en_route', 'arrivee', 'probleme'];
// catégorie → [type d'incident, libellé]
const CATS = {
  casse:  ['materiel_endommage', 'Casse'],
  abime:  ['materiel_endommage', 'Appareil abîmé'],
  manque: ['autre', 'Élément manquant'],
  panne:  ['probleme_technique', 'Ne fonctionne pas'],
  froid:  ['probleme_technique', 'Ne refroidit pas'],
  allume: ['probleme_technique', 'Ne s’allume pas'],
  fuite:  ['probleme_technique', 'Fuite d’eau'],
  bruit:  ['probleme_technique', 'Bruit anormal'],
  autre:  ['autre', 'Autre'],
};
// Préfixes du créneau : le transporteur voit tout de suite l'urgence, et
// transporteur-action.js sait à qui envoyer le SMS « il vous attend ».
const URGENT = 'URGENT';
const SANS_URGENCE = 'Reprise';

function categorie(c) { return CATS[c] ? c : 'autre'; }

// Appareils libres au point aujourd'hui : stock − locations en cours −
// appareils abîmés qui attendent d'être repris (missions ouvertes au point).
async function appareilsLibresAuPoint(supabase, point) {
  const jour = todayParis();
  // avecPannes: false : les appareils abîmés en attente sont retirés juste en dessous.
  const occ = await occupationParPoint(supabase, [point], jour, addDays(jour, 1), { avecAttente: false, avecPannes: false }).catch(() => ({}));
  const enAttente = await missionsOuvertesAuPoint(supabase, point);
  const stock = Number.isInteger(point.stock) ? point.stock : STOCK_PAR_DEFAUT; // 0 = point vidé (admin) : rien à échanger
  return stock - (occ[point.id] || 0) - enAttente.length;
}

// Adresse d'une mission au point : c'est elle que voit le transporteur (et
// non l'adresse du client), et elle sert à compter les missions du point.
function adressePoint(point) { return `${point.nom} — ${point.adresse}`; }

async function missionsOuvertesAuPoint(supabase, point) {
  const { data } = await supabase.from('livraisons')
    .select('id, date_prevue, creneau')
    .eq('type', 'changement').in('statut', OUVERTS)
    .eq('adresse_libre', adressePoint(point)).limit(50);
  return Array.isArray(data) ? data : [];
}

// Point Click & Collect le plus proche d'un client livré à domicile (vrais
// points seulement, jamais un point d'exemple ou de test). Adresse placée
// sur la carte par la Base Adresse Nationale ; sinon, même code postal ;
// sinon, le premier point ouvert de sa ville.
async function pointLePlusProche(r) {
  // Hors saison (climatiseurs repris fin septembre, déposés mi-mai), un point
  // n'a plus d'appareil à échanger : on ne l'envoie pas là-bas (ticket admin).
  const jour = todayParis();
  const points = POINTS_RETRAIT.filter((p) => !p.test && !p.exemple && !horsSaison(p, jour, jour));
  if (!points.length) return null;
  try {
    const u = 'https://api-adresse.data.gouv.fr/search/?limit=1&q=' + encodeURIComponent(String(r.adresse || '').slice(0, 200));
    const j = await (await fetch(u, { signal: AbortSignal.timeout(3000) })).json();
    const c = j && j.features && j.features[0] && j.features[0].geometry && j.features[0].geometry.coordinates;
    if (c) {
      const d = (p) => Math.hypot((p.lat - c[1]) * 111, (p.lng - c[0]) * 111 * Math.cos(c[1] * Math.PI / 180));
      return points.slice().sort((a, b) => d(a) - d(b))[0];
    }
  } catch (e) { /* carte indisponible : on se replie sur le code postal */ }
  const cp = extractPostalCode(r.adresse || '');
  return points.find((p) => cp && String(p.adresse || '').includes(cp)) || points[0];
}

async function creerMission(supabase, r, { date, creneau, incidentId, urgent, libelle, point }) {
  // les missions de panne se font toujours au point : jamais chez le client
  // pas de doublon : un remplacement déjà ouvert pour cette location suffit
  const { data: deja } = await supabase.from('livraisons').select('id, transporteur_id, date_prevue')
    .eq('reservation_id', r.id).eq('type', 'changement').in('statut', OUVERTS).limit(1);
  if (deja && deja.length) return Object.assign({ existait: true }, deja[0]);
  const tid = await pickTransporteurForMission(supabase, { cityId: r.city_id, dateISO: date, creneau: null, adresse: point ? adressePoint(point) : r.adresse, usedInBatch: new Set(), type: 'changement', installation: null }).catch(() => null);
  const { data: ra } = await supabase.from('reservation_appareils').select('appareils(numero)').eq('reservation_id', r.id).limit(1);
  const { data: liv, error } = await supabase.from('livraisons').insert({
    reservation_id: r.id, type: 'changement', date_prevue: date, statut: 'a_faire',
    transporteur_id: tid || null, incident_id: incidentId || null, creneau: String(creneau).slice(0, 100),
    adresse_libre: point ? adressePoint(point) : null,
    ancien_appareil_numero: (ra && ra[0] && ra[0].appareils && ra[0].appareils.numero) || null,
  }).select('id, transporteur_id, date_prevue').single();
  if (error) { console.error('[panne mission]', error.message); return null; }
  if (liv.transporteur_id) {
    const ou = point ? `au point ${point.nom}` : 'chez le client';
    await notifyTransporteur(supabase, liv.transporteur_id, {
      type: 'nouvelle_mission', livraisonId: liv.id, tag: 'nouvelle-mission',
      message: urgent ? `Remplacement urgent ${ou} (${libelle.toLowerCase()}).` : `Reprise d’un appareil abîmé ${ou}, sans urgence.`,
    }).catch(() => {});
  }
  return liv;
}

// moment : 'location' (chez soi, page /panne), 'retrait', 'echange' (au
// comptoir pendant la location), 'retour'.
async function declarerPanne(supabase, { r, point, categorie: c, moment, message, photos, canal, appareil }) {
  // client livré : seul un CLIMATISEUR MOBILE se rapporte au point (un
  // PortaSplit fixé à la fenêtre ou un rafraîchisseur ne se transporte pas) ;
  // pour les autres appareils, ticket : l'admin organise la suite.
  const transportable = r.source_channel === 'click_collect' || !appareil || appareil === 'climatiseur';
  const nomAppareil = { climatiseur: 'climatiseur mobile', portasplit: 'PortaSplit', rafraichisseur: 'rafraîchisseur' }[appareil] || '';
  const cle = categorie(c);
  const [typeIncident, libelle] = CATS[cle];
  const msg = String(message || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const ph = (Array.isArray(photos) ? photos : []).slice(0, 3);
  const ou = (r.source_channel === 'click_collect' ? 'Click & Collect' : 'Client livré à domicile') + (point ? ` · ${point.nom}` : '');
  const quand = { location: 'pendant la location (chez lui)', retrait: 'au retrait', echange: 'au comptoir, en cours de location', retour: 'au retour' }[moment] || moment;
  const description = `[${ou} · déclaré par le client ${quand}${canal ? ' · ' + canal : ''}${nomAppareil ? ' · ' + nomAppareil : ''}] ${libelle}${msg ? ' — ' + msg : ''}`;

  // 1. ticket admin — UNE panne = UN dossier : si le client a déjà déclaré
  // cette panne (ex. chez lui sur /panne, puis il vient l'échanger au
  // comptoir), on complète le même dossier au lieu d'en ouvrir un second.
  let incidentId = null;
  if (cle !== 'autre' && moment !== 'retour') {
    const { data: ouvert } = await supabase.from('incidents').select('id, description')
      .eq('reservation_id', r.id).in('statut', INCIDENT_OPEN_STATUSES).neq('type', 'autre')
      .order('id', { ascending: false }).limit(1);
    if (ouvert && ouvert[0]) {
      incidentId = ouvert[0].id;
      await supabase.from('incidents').update({ description: `${ouvert[0].description || ''}\n+ ${description}`.slice(0, 2000) }).eq('id', incidentId).then(() => {}, () => {});
    }
  }
  if (!incidentId) {
    const { data: inc, error: incErr } = await supabase.from('incidents').insert({
      city_id: r.city_id || null, reservation_id: r.id, type: typeIncident, description, photos: ph.length ? ph : null, statut: 'nouveau',
    }).select('id').single();
    if (incErr) console.error('[panne incident]', incErr.message);
    incidentId = inc ? inc.id : null;
  }
  const dossier = incidentId ? 'P-' + incidentId : null;

  // 2. la suite, décidée toute seule
  let issue = 'ticket', mission = null, sansPoint = false, nonTransportable = false;
  const jour = todayParis(), demain = addDays(jour, 1);
  try {
    if (cle === 'autre' || !r.city_id) {
      issue = 'ticket';
    } else if (!transportable) {
      issue = 'ticket'; nonTransportable = true;
    } else if (!point && !(point = await pointLePlusProche(r))) {
      // client livré, mais aucun point Click & Collect ouvert : ticket, l'admin décide
      issue = 'ticket'; sansPoint = true;
    } else {
      const libres = await appareilsLibresAuPoint(supabase, point);
      // date d'une reprise sans urgence : la prochaine mission déjà prévue à
      // ce point (un seul passage pour tout), sinon demain
      const ouvertes = await missionsOuvertesAuPoint(supabase, point);
      const prochaine = ouvertes.map((m) => m.date_prevue).filter((d) => d >= jour).sort()[0];
      const dateReprise = prochaine || demain;
      const reprise = () => creerMission(supabase, r, { date: dateReprise, creneau: `${SANS_URGENCE} · au point ${point.nom} · ${libelle}${msg ? ' : ' + msg : ''}`, incidentId, urgent: false, libelle, point });
      const urgence = () => creerMission(supabase, r, { date: heureParis() < 18 ? jour : demain, creneau: `${URGENT} · au point ${point.nom} · ${libelle}${msg ? ' : ' + msg : ''}`, incidentId, urgent: true, libelle, point });
      if (moment === 'retour') {
        issue = 'ticket'; mission = await reprise();
      } else if (libres > 0 && moment === 'location') {
        // le client rapporte l'appareil : la reprise sera créée au moment de
        // l'échange au comptoir (l'appareil abîmé n'est pas encore au point)
        issue = 'rapporter_au_point';
      } else if (libres > 0) {
        issue = 'echange_comptoir';
        // l'appareil abîmé reste au point : sa reprise est calée sans urgence
        mission = await reprise();
      } else {
        issue = 'reapprovisionnement'; mission = await urgence();
      }
    }
  } catch (e) { console.error('[panne suite]', e.message); }

  // 3. prévenir l'admin (une seule alerte, avec la suite déjà décidée)
  const SUITE = {
echange_comptoir: '🔁 échange immédiat au comptoir',
    rapporter_au_point: '🔁 le client rapporte au point (échange sur place)', reapprovisionnement: '🚨 plus d’appareil au point : remplacement URGENT',
    ticket: nonTransportable ? `📋 ${nomAppareil} en panne chez le client : À ORGANISER (rappeler le client)` : sansPoint ? '📋 client livré, AUCUN point ouvert : à gérer' : '📋 ticket',
  };
  const attrib = mission ? (mission.transporteur_id ? ' · transporteur attribué' : ' · À ATTRIBUER') : '';
  await pushToAdmin(supabase, {
    title: `⚠️ ${libelle} — ${point ? point.nom : 'client livré'}`,
    body: `${dossier || ''} ${r.ref || ''} — ${r.prenom || ''} ${r.nom || ''} · ${SUITE[issue]}${attrib}${msg ? ' · « ' + msg + ' »' : ''}${ph.length ? ' · 📷 ' + ph.length : ''}`.replace(/\s+/g, ' ').trim(),
    tag: `panne-${r.id}`,
  }).catch(() => {});

  return { issue, dossier, incidentId, point: point || null, mission: mission ? { id: mission.id, date: mission.date_prevue, attribuee: !!mission.transporteur_id } : null };
}

module.exports = { declarerPanne, appareilsLibresAuPoint, CATS, URGENT, SANS_URGENCE };
