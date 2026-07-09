function isValidDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str || '') && !Number.isNaN(new Date(str + 'T00:00:00Z').getTime());
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = { isValidDate, addDays };
