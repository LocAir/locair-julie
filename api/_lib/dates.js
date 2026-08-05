function isValidDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str || '') && !Number.isNaN(new Date(str + 'T00:00:00Z').getTime());
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayParis() {
  // Intl.DateTimeFormat avec timeZone 'Europe/Paris' gère automatiquement
  // l'heure d'été/hiver — pas besoin de calculer l'offset à la main.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

module.exports = { isValidDate, addDays, todayParis };
