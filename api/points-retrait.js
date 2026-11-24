// Liste publique des points de retrait Click & Collect (lue par la page
// /click-and-collect). La liste elle-même vit dans _lib/pointsRetrait.js.
const { POINTS_RETRAIT, getCellule } = require('./_lib/pointsRetrait');
const { REGLES } = require('./_lib/tarifDynamique');

module.exports = (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  // 5 min dans le cache de Vercel : la page reste rapide, et une liste
  // modifiée apparaît vite.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  // prix Click & Collect (7 jours) : base, minimum, maximum — lus par la page
  // Seulement ce dont la page a besoin : jamais la commission, le stock ni
  // le code partenaire du commerçant. Le point de test n'apparaît qu'avec ?test=1.
  const test = (req.query || {}).test === '1';
  const CHAMPS = ['id', 'ville', 'nom', 'lat', 'lng', 'adresse', 'horaires', 'fermes', 'ouverture', 'photos', 'exemple', 'zone', 'livraison'];
  const points = POINTS_RETRAIT.filter((p) => test || !p.test)
    .map((p) => {
      const o = Object.fromEntries(CHAMPS.filter((k) => k in p).map((k) => [k, p[k]]));
      // Saison de sa cellule (playbook) : la page grise les jours hors saison
      // et propose d'office le 1er jour ouvert. Point de test : toute l'année.
      if (!p.test) { const c = getCellule(p.cellule); o.saison = { ouverture: c.ouverture || '05-16', fin: c.fin_saison || '09-30' }; }
      return o;
    });
  return res.status(200).json({ points, tarif: { baseSemaine: REGLES.baseSemaineEur, minSemaine: REGLES.minSemaineEur, maxSemaine: REGLES.maxSemaineEur, court: REGLES.court } });
};
