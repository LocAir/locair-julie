const { getSupabase } = require('./_lib/supabase');
const { getCity }     = require('./_lib/city');
const { checkAdminToken } = require('./_lib/auth');

// Fiche client persistante — déduplication par téléphone (voir
// _lib/reservations.js:findOrCreateClient). acces_difficile est une note
// libre qui enrichit la fiche pour la prochaine visite (digicode, étage sans
// ascenseur, parking impossible...) — jamais un blocage, juste une info
// consultée par l'admin et le livreur.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    const city = await getCity(supabase);

    if (action === 'list') {
      const { data: clients, error } = await supabase
        .from('clients')
        .select('id, prenom, nom, tel, email, acces_difficile, created_at')
        .eq('city_id', city.id)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const clientIds = (clients || []).map(c => c.id);
      const resasByClient = {};
      if (clientIds.length) {
        const { data: resas } = await supabase
          .from('reservations')
          .select('client_id, adresse, date_debut, statut')
          .in('client_id', clientIds)
          .order('date_debut', { ascending: false });
        (resas || []).forEach(r => {
          (resasByClient[r.client_id] = resasByClient[r.client_id] || []).push(r);
        });
      }

      const result = (clients || []).map(c => {
        const resas = resasByClient[c.id] || [];
        return {
          ...c,
          nb_reservations:  resas.length,
          derniere_adresse: resas[0]?.adresse || null,
        };
      });
      return res.status(200).json({ clients: result });
    }

    if (action === 'update') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { data: before } = await supabase.from('clients').select('id').eq('id', id).eq('city_id', city.id).maybeSingle();
      if (!before) return res.status(404).json({ error: 'Client introuvable' });
      const { error } = await supabase
        .from('clients').update({ acces_difficile: (body.acces_difficile || '').slice(0, 1000) }).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin clients]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
