const crypto = require('crypto');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./ratelimit');

function safeEqual(a, b) {
  try { return crypto.timingSafeEqual(Buffer.from(String(a)), Buffer.from(String(b))); } catch { return false; }
}

// Rate-limité ici plutôt que dans le seul endpoint admin-login.js : comme
// chaque route /api/admin-*.js revalide le mot de passe à chaque appel (pas
// de session serveur), le blocage doit s'appliquer partout où ce mot de passe
// est vérifié, pas uniquement à l'écran de connexion.
async function checkAdminToken(req, supabase) {
  const rateKey = `admin:${getClientIp(req)}`;
  if (await isRateLimited(supabase, rateKey)) return false;

  const token = ((req.body || {}).token || req.headers['x-admin-token'] || '').trim();
  const ok = Boolean(process.env.ADMIN_PASSWORD) && safeEqual(token, process.env.ADMIN_PASSWORD);
  if (!ok) await recordFailedAttempt(supabase, rateKey);
  return ok;
}

// Un transporteur s'identifie par son PIN personnel (voir transporteur-login.js),
// qui lui renvoie un jeton signé `<id>.<empreinte du PIN>.<signature>`. L'empreinte
// du PIN (pas le PIN lui-même) est incluse pour que le jeton devienne invalide
// automatiquement dès que le PIN change (reset "code oublié", ou changé par
// l'admin) — sans ça, un ancien jeton resterait valable indéfiniment même après
// un changement de code. L'id est toujours lu DANS le jeton vérifié, jamais un
// transporteur_id fourni tel quel par le client, ce qui empêche un livreur
// d'agir avec l'identité d'un collègue.
function pinFingerprint(pin) {
  return crypto.createHash('sha256').update(String(pin || '')).digest('hex').slice(0, 16);
}

function signTransporteurToken(transporteurId, pin) {
  const secret  = process.env.TRANSPORTEUR_SECRET || '';
  const payload = `${transporteurId}.${pinFingerprint(pin)}`;
  const sig     = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

// Vérifie la signature ET que le PIN n'a pas changé depuis l'émission du jeton
// (nécessite une lecture en base — appelé une fois par requête, coût négligeable
// à cette échelle). Renvoie l'id transporteur authentifié, ou null.
async function verifyTransporteurToken(req, supabase) {
  const secret = process.env.TRANSPORTEUR_SECRET;
  if (!secret) return null;
  const token = ((req.body || {}).token || req.headers['x-transporteur-token'] || '').trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [idStr, fingerprint, sig] = parts;
  const payload  = `${idStr}.${fingerprint}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (!safeEqual(sig, expected)) return null;

  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id) || id <= 0) return null;

  const { data: t } = await supabase.from('transporteurs').select('pin, actif').eq('id', id).maybeSingle();
  if (!t || !t.actif || !safeEqual(fingerprint, pinFingerprint(t.pin))) return null;

  return id;
}

// Même mécanisme que signTransporteurToken/verifyTransporteurToken ci-dessus,
// pour l'espace partenaire (conciergeries...). Réutilise TRANSPORTEUR_SECRET
// (déjà configuré en prod) plutôt qu'un nouveau secret dédié — le préfixe
// "partenaire:" dans le payload signé empêche tout chevauchement avec un
// jeton transporteur qui aurait par hasard le même id/empreinte de PIN.
function signPartenaireToken(partenaireId, pin) {
  const secret  = process.env.TRANSPORTEUR_SECRET || '';
  const payload = `partenaire:${partenaireId}.${pinFingerprint(pin)}`;
  const sig     = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

async function verifyPartenaireToken(req, supabase) {
  const secret = process.env.TRANSPORTEUR_SECRET;
  if (!secret) return null;
  const token = ((req.body || {}).token || req.headers['x-partenaire-token'] || '').trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [prefixedId, fingerprint, sig] = parts;
  if (!prefixedId.startsWith('partenaire:')) return null;
  const payload  = `${prefixedId}.${fingerprint}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (!safeEqual(sig, expected)) return null;

  const id = parseInt(prefixedId.slice('partenaire:'.length), 10);
  if (!Number.isFinite(id) || id <= 0) return null;

  const { data: p } = await supabase.from('partenaires').select('pin, actif').eq('id', id).maybeSingle();
  if (!p || !p.actif || !safeEqual(fingerprint, pinFingerprint(p.pin))) return null;

  return id;
}

// Espace client (Module 4) : pas de compte, pas de mot de passe — le client
// s'identifie une fois par email + numéro de commande (voir
// api/client-login.js), qui lui renvoie ce jeton pour éviter de ressaisir
// ses informations à chaque visite. Même mécanisme que
// signPartenaireToken/verifyPartenaireToken ci-dessus (réutilise
// TRANSPORTEUR_SECRET, préfixe "client:" pour éviter tout chevauchement),
// mais l'empreinte porte sur le numéro de commande (ref) plutôt qu'un PIN —
// il n'y a rien d'autre à invalider ce jeton, hormis la suppression de la
// réservation elle-même, revérifiée en base à chaque appel.
function refFingerprint(ref) {
  return crypto.createHash('sha256').update(String(ref || '')).digest('hex').slice(0, 16);
}

function signClientToken(reservationId, ref) {
  const secret  = process.env.TRANSPORTEUR_SECRET || '';
  const payload = `client:${reservationId}.${refFingerprint(ref)}`;
  const sig     = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

async function verifyClientToken(req, supabase) {
  const secret = process.env.TRANSPORTEUR_SECRET;
  if (!secret) return null;
  const token = ((req.body || {}).token || req.headers['x-client-token'] || '').trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [prefixedId, fingerprint, sig] = parts;
  if (!prefixedId.startsWith('client:')) return null;
  const payload  = `${prefixedId}.${fingerprint}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (!safeEqual(sig, expected)) return null;

  const id = parseInt(prefixedId.slice('client:'.length), 10);
  if (!Number.isFinite(id) || id <= 0) return null;

  const { data: r } = await supabase.from('reservations').select('ref').eq('id', id).maybeSingle();
  if (!r || !safeEqual(fingerprint, refFingerprint(r.ref))) return null;

  return id;
}

module.exports = {
  safeEqual, checkAdminToken,
  signTransporteurToken, verifyTransporteurToken,
  signPartenaireToken, verifyPartenaireToken,
  signClientToken, verifyClientToken,
};
