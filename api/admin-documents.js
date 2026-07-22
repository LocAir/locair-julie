const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity } = require('./_lib/city');
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

    if (action === 'list') {
      const reservationId = parseInt(body.reservation_id);
      if (!reservationId) return res.status(400).json({ error: 'reservation_id manquant' });

      // Vérifie que la réservation appartient bien à la ville de l'admin
      // connecté avant de révéler quoi que ce soit sur ses documents.
      const { data: resa } = await supabase
        .from('reservations').select('id').eq('id', reservationId).eq('city_id', city.id).maybeSingle();
      if (!resa) return res.status(404).json({ error: 'Réservation introuvable' });

      const { data, error } = await supabase
        .from('documents')
        .select('id, type, numero, version, statut, montant_ttc_cents, genere_at, envoye_at, consulte_at')
        .eq('reservation_id', reservationId)
        .order('genere_at', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ documents: data || [] });
    }

    if (action === 'view_url') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });

      // Jointure via reservations pour vérifier le cloisonnement par ville —
      // un admin ne doit jamais pouvoir obtenir l'URL d'un document d'une
      // autre ville en devinant un id.
      const { data: doc } = await supabase
        .from('documents')
        .select('storage_path, reservation:reservations!inner(city_id)')
        .eq('id', id).eq('reservation.city_id', city.id).maybeSingle();
      if (!doc) return res.status(404).json({ error: 'Document introuvable' });

      const { data, error } = await supabase.storage.from('missions').createSignedUrl(doc.storage_path, 3600);
      if (error) throw error;
      return res.status(200).json({ url: data.signedUrl });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin documents]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
