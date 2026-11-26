// Compteur d'étapes de la page Click & Collect (sans cookie, sans donnée
// personnelle) : nom de l'étape, variante du titre (test A/B), numéro de
// visite tiré au hasard par le navigateur et oublié à la fermeture de
// l'onglet. Ni IP, ni appareil, ni email ne sont enregistrés.
// Lecture : api/admin-cc-entonnoir.js → admin/cc-stats.html.
// Table : supabase/migration_2026-11-20_cc_evenements.sql (tant qu'elle
// n'existe pas, on ne fait rien et on ne renvoie pas d'erreur).
const { getSupabase } = require('./_lib/supabase');

const ETAPES = new Set(['cc_vue', 'cc_ticket', 'cc_geoloc', 'cc_ville', 'cc_carte_point', 'cc_express',
  'cc_dates_rapides', 'cc_tarif_duree', 'cc_vers_paiement', 'cc_paiement', 'cc_chat', 'cc_avis_google']);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const e = String(b.e || '');
  const v = b.v === 'B' ? 'B' : 'A';
  const s = String(b.s || '').replace(/[^a-z0-9]/gi, '').slice(0, 16);
  if (!ETAPES.has(e) || s.length < 6) return res.status(204).end();
  try {
    const { error } = await getSupabase().from('cc_evenements').insert({ evenement: e, variante: v, visite: s });
    if (error && !/cc_evenements|does not exist|42P01/.test(error.message + (error.code || ''))) console.error('[cc-evenement]', error.message);
  } catch (err) { console.error('[cc-evenement]', err.message); }
  return res.status(204).end();
};
