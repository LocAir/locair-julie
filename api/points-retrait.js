// Liste publique des points de retrait Click & Collect (lue par la page
// /click-and-collect). La liste elle-même vit dans _lib/pointsRetrait.js.
const { POINTS_RETRAIT } = require('./_lib/pointsRetrait');

module.exports = (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  // 5 min dans le cache de Vercel : la page reste rapide, et une liste
  // modifiée apparaît vite.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({ points: POINTS_RETRAIT });
};
