const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity } = require('./_lib/city');
const { getAvailability } = require('./_lib/stock');
const { checkAdminToken } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    const city = await resolveAdminCity(supabase, body);
    if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });

    if (action === 'add') {
      const { data: maxRow } = await supabase
        .from('appareils').select('numero').eq('city_id', city.id)
        .order('numero', { ascending: false }).limit(1).maybeSingle();
      const numero = (maxRow?.numero || 0) + 1;
      const { data, error } = await supabase
        .from('appareils').insert({ city_id: city.id, numero }).select().single();
      if (error) throw error;
      return res.status(200).json({ ok: true, appareil: data });
    }

    if (action === 'update') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const patch = {};
      if (body.statut != null) {
        if (!['disponible', 'panne', 'maintenance', 'loue'].includes(body.statut)) {
          return res.status(400).json({ error: 'Statut invalide' });
        }
        patch.statut = body.statut;
      }
      if (body.reference != null) patch.reference = body.reference.trim().slice(0, 200) || null;
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Rien à modifier' });
      const { error } = await supabase.from('appareils').update(patch).eq('id', id).eq('city_id', city.id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { data: owned } = await supabase.from('appareils').select('id').eq('id', id).eq('city_id', city.id).maybeSingle();
      if (!owned) return res.status(404).json({ error: 'Unité introuvable' });

      const { error } = await supabase.from('appareils').delete().eq('id', id);
      if (error) {
        // Contrainte de clé étrangère : une unité déjà attachée à une réservation
        // (même passée) a un historique de missions à garder — on refuse la
        // suppression et on suggère de la marquer "En panne" pour la sortir du
        // service à la place.
        if (error.code === '23503') {
          return res.status(409).json({ error: 'Impossible de supprimer : cette unité a un historique de missions. Marque-la plutôt "En panne" pour la retirer du service.' });
        }
        throw error;
      }
      return res.status(200).json({ ok: true });
    }

    // action 'list' (par défaut)
    const { data: appareils, error } = await supabase
      .from('appareils').select('*').eq('city_id', city.id).order('numero');
    if (error) throw error;

    const today    = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const disponibles = Math.max(0, await getAvailability(supabase, city.id, today, tomorrow));

    // Un appareil est "chez le client" s'il est lié à une réservation confirmée
    // dont la période couvre aujourd'hui. Filtré en JS plutôt qu'avec un embed
    // PostgREST filtré (plus simple à garder correct, volume négligeable à cette échelle).
    const { data: liens } = await supabase
      .from('reservation_appareils')
      .select('appareil_id, reservation:reservations(statut, date_debut, date_fin)');
    const enLocationIds = new Set(
      (liens || [])
        .filter(l => l.reservation && l.reservation.statut === 'confirmee'
          && l.reservation.date_debut <= today && l.reservation.date_fin > today)
        .map(l => l.appareil_id)
    );

    const list = (appareils || []).map(a => ({ ...a, en_location: enLocationIds.has(a.id) }));
    const actifs = list.filter(a => !['panne', 'maintenance', 'loue'].includes(a.statut)).length;

    return res.status(200).json({
      ville:        city.name,
      appareils:    list,
      total:        list.length,
      actifs,
      disponibles,
      en_location:  enLocationIds.size,
    });
  } catch (err) {
    console.error('[Admin stock]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
