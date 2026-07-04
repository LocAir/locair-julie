function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
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
