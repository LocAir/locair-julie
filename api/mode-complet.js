const { getSupabase }     = require('./_lib/supabase');
const { getCity, isCitySoldOut } = require('./_lib/city');
const { getAvailability } = require('./_lib/stock');
const { todayParis, addDays } = require('./_lib/dates');

// En mode "auto" (par défaut), sold_out est recalculé en base à partir du
// stock réel (triggers de migration_auto_sold_out.sql) — cet endpoint
// revérifie quand même en temps réel (disponibles) pour ne jamais dépendre
// d'un trigger SQL qui aurait raté ou d'un statut d'appareil changé hors
// circuit. En mode "manuel" (migration_sold_out_mode.sql), l'admin garde
// la main via le bouton "Passer en complet" côté admin/index.html — ce
// choix explicite doit toujours l'emporter, même si le stock réel montre
// encore des appareils disponibles (bug corrigé : jusqu'ici ce mode manuel
// n'avait aucun effet sur le site, cet endpoint recalculait toujours à
// partir du stock réel sans jamais lire sold_out_mode).
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

  // Lecture publique de l'état sold_out + compteur temps réel (le site en
  // fait un texte "Plus que N appareil(s) disponible(s)" synchronisé avec le
  // vrai stock, y compris les appareils marqués "loué" hors système).
  try {
    const city = await getCity(supabase);
    const today    = todayParis();
    const tomorrow = addDays(today, 1);
    const disponibles = Math.max(0, await getAvailability(supabase, city.id, today, tomorrow));
    const soldOut = await isCitySoldOut(supabase, city);
    return res.status(200).json({ sold_out: soldOut, disponibles });
  } catch (err) {
    console.error('[mode-complet GET]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
