// x-forwarded-for est une liste "client, proxy1, proxy2, …" où chaque saut
// AJOUTE son IP à la fin. Un client peut donc écrire n'importe quelle valeur
// en première position, mais pas falsifier ce que Vercel (le seul proxy en
// amont de cette fonction) ajoute lui-même à la fin. Prendre le PREMIER élément
// rendrait le rate-limit trivialement contournable (un en-tête différent à
// chaque tentative) ; on prend donc le DERNIER, qui est celui observé par Vercel.
function getClientIp(req) {
  const parts = (req.headers['x-forwarded-for'] || '').split(',');
  return parts[parts.length - 1].trim() || 'unknown';
}

// Bloque après trop d'échecs récents pour une même clé (ex. "admin:1.2.3.4").
// Ne protège pas contre un attaquant qui change d'IP à chaque essai — suffisant
// contre un script naïf qui essaie toutes les combinaisons d'un code à 4-6
// chiffres depuis une seule adresse.
async function isRateLimited(supabase, key, maxAttempts = 10, windowMinutes = 15) {
  const since = new Date(Date.now() - windowMinutes * 60000).toISOString();
  const { count } = await supabase
    .from('login_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('key', key)
    .gte('created_at', since);
  return (count || 0) >= maxAttempts;
}

async function recordFailedAttempt(supabase, key) {
  await supabase.from('login_attempts').insert({ key }).then(null, () => {});
}

module.exports = { getClientIp, isRateLimited, recordFailedAttempt };
