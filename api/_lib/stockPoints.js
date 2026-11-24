// Stock de climatiseurs de chaque point de retrait, modifiable depuis l'admin
// (25/11/2026, demande du propriétaire) : il peut évoluer d'un point à
// l'autre et dans le temps, avec l'accord du gérant, sans toucher au code.
//
// Le chiffre écrit dans _lib/pointsRetrait.js (`stock`, sinon 4) reste la
// valeur de départ (`stock_code`). Une ligne de la table stock_points le
// remplace. Chaque changement est gardé dans stock_points_historique.
// La valeur est relue au plus toutes les 60 s ; si la table manque ou ne se
// lit pas, on garde le chiffre du code (rien ne casse).
const { POINTS_RETRAIT } = require('./pointsRetrait');

const DUREE_CACHE_MS = 60 * 1000;
let lu = 0;
let table = null; // true : table lue ; false : absente ; null : jamais lue

function appliquer(map) {
  for (const p of POINTS_RETRAIT) {
    const v = map[p.id];
    p.stock = Number.isInteger(v) && v >= 0 ? v : p.stock_code;
    p.stock_modifie = Number.isInteger(v) && v !== p.stock_code;
  }
}

async function chargerStocks(supabase, { force } = {}) {
  if (!force && Date.now() - lu < DUREE_CACHE_MS) return table;
  lu = Date.now();
  try {
    const { data, error } = await supabase.from('stock_points').select('point_id, stock');
    if (error) throw error;
    const map = {};
    for (const r of data || []) map[r.point_id] = Number(r.stock);
    appliquer(map);
    table = true;
  } catch (_e) {
    table = false; // on garde le stock du code
  }
  return table;
}

module.exports = { chargerStocks, appliquerStocks: appliquer };
