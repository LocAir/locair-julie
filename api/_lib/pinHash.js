const crypto = require('crypto');
const SALT_LEN = 16;
const KEY_LEN  = 32;
const SCRYPT_N = 16384;
const OPTS     = { N: SCRYPT_N, r: 8, p: 1 };

// Préfixe "s1:" = scrypt version 1 — distingue les anciens PINs en clair
// (6 chiffres, pas de préfixe) des nouveaux hachés, pour la migration progressive.
function hashPin(pin) {
  const salt = crypto.randomBytes(SALT_LEN);
  const key  = crypto.scryptSync(String(pin), salt, KEY_LEN, OPTS);
  return `s1:${salt.toString('hex')}:${key.toString('hex')}`;
}

function verifyPin(plain, stored) {
  try {
    if (!stored || !stored.startsWith('s1:')) return false;
    const parts   = stored.split(':');
    const salt    = Buffer.from(parts[1], 'hex');
    const key     = Buffer.from(parts[2], 'hex');
    const derived = crypto.scryptSync(String(plain), salt, KEY_LEN, OPTS);
    return crypto.timingSafeEqual(derived, key);
  } catch { return false; }
}

module.exports = { hashPin, verifyPin };
