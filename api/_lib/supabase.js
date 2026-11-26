const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getSupabase() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquantes');
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  // Points de retrait créés dans l'admin : lus en fond dès la 1re connexion
  // (les fonctions qui en ont besoin tout de suite attendent chargerPoints()).
  setImmediate(() => { try { require('./pointsRetrait').chargerPoints(_client); } catch (_e) { /* rien */ } });
  return _client;
}

module.exports = { getSupabase };
