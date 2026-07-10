const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const transporteurId = await verifyTransporteurToken(req, supabase);
  if (!transporteurId) return res.status(401).json({ error: 'Session invalide' });

  try {
    const { data, error } = await supabase
      .from('livraisons')
      .select(`
        id, type, statut, date_prevue, creneau,
        photo_depart_path, photo_installation_path, photo_retour_path, client_notifie_at,
        vidange_confirmee,
        probleme_type, probleme_description,
        reservation:reservations (
          prenom, nom, tel, adresse, etage, ascenseur, fenetre, installation, quantite, instructions_acces,
          reservation_appareils ( appareil:appareils ( numero ) ),
          client:clients ( acces_difficile )
        )
      `)
      .eq('transporteur_id', transporteurId)
      .in('statut', ['a_faire', 'acceptee', 'arrivee', 'probleme'])
      .order('date_prevue', { ascending: true })
      .order('creneau', { ascending: true });
    if (error) throw error;

    const missions = (data || []).map(m => ({
      id:                  m.id,
      type:                m.type,
      statut:              m.statut,
      date_prevue:         m.date_prevue,
      creneau:             m.creneau,
      photo_depart_ok:     Boolean(m.photo_depart_path),
      photo_installation_ok: Boolean(m.photo_installation_path),
      photo_retour_ok:     Boolean(m.photo_retour_path),
      vidange_ok:          Boolean(m.vidange_confirmee),
      client_notifie:      Boolean(m.client_notifie_at),
      probleme_type:       m.probleme_type,
      probleme_description: m.probleme_description,
      appareil_numeros: ((m.reservation?.reservation_appareils) || [])
        .map(ra => ra.appareil?.numero).filter(n => n != null).sort((a, b) => a - b),
      acces_difficile: m.reservation?.client?.acces_difficile || null,
      client: m.reservation || null,
    }));

    return res.status(200).json({ missions });
  } catch (err) {
    console.error('[Transporteur missions]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
