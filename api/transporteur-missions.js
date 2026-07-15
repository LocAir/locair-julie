const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');
const { computeBareme, getBaremeByCityIds } = require('./_lib/bareme');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const transporteurId = await verifyTransporteurToken(req, supabase);
  if (!transporteurId) return res.status(401).json({ error: 'Session invalide' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    // Signe les URLs des photos d'une mission passée, pour "Mon activité"
    // (transporteur-earnings.js action 'resume' fournit déjà l'historique
    // complet des missions "fait" avec leur id — inutile de le dupliquer
    // ici, seule la récupération des photos manque). Vérifie que la mission
    // appartient bien à ce transporteur — même garde-fou que
    // fenetre_photo_url dans transporteur-action.js. Fenêtre de 90 jours
    // décidée avec Aly : assez large pour couvrir un litige tardif, sans
    // accès illimité.
    if (action === 'past_photos') {
      const livraisonId = parseInt(body.livraison_id);
      if (!livraisonId) return res.status(400).json({ error: 'livraison_id manquant' });
      const cutoff90 = new Date();
      cutoff90.setDate(cutoff90.getDate() - 90);
      const { data: liv } = await supabase
        .from('livraisons')
        .select('fait_at, photo_depart_path, photo_installation_path, photo_retour_path, photo_absence_path')
        .eq('id', livraisonId).eq('transporteur_id', transporteurId).maybeSingle();
      if (!liv) return res.status(404).json({ error: 'Mission introuvable' });
      if (!liv.fait_at || new Date(liv.fait_at) < cutoff90) {
        return res.status(404).json({ error: 'Photos disponibles seulement pour les 90 derniers jours' });
      }

      const KINDS = [
        ['photo_depart',       liv.photo_depart_path],
        ['photo_installation', liv.photo_installation_path],
        ['photo_retour',       liv.photo_retour_path],
        ['photo_absence',      liv.photo_absence_path],
      ];
      const photos = {};
      await Promise.all(KINDS.map(async ([kind, path]) => {
        if (!path) return;
        const { data: urlData } = await supabase.storage.from('missions').createSignedUrl(path, 300);
        if (urlData?.signedUrl) photos[kind] = urlData.signedUrl;
      }));
      return res.status(200).json({ photos });
    }

    // Les missions actives (à traiter) remontent sans limite de date ; les
    // missions "fait" ne remontent que sur les 14 derniers jours — le filtre
    // "Terminées" sert à confirmer ce qui vient d'être fait, pas à
    // reconstituer tout l'historique (déjà disponible dans "Mon activité").
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from('livraisons')
      .select(`
        id, type, statut, date_prevue, creneau, titre, adresse_libre, montant_du_cents,
        photo_depart_path, photo_installation_path, photo_retour_path, client_notifie_at,
        demo_faite, incident_id,
        vidange_confirmee,
        probleme_type, probleme_description,
        reservation:reservations (
          prenom, nom, tel, tel_secondaire, type_client, raison_sociale, adresse, etage, ascenseur, fenetre, fenetre_photo_path, installation, quantite, instructions_acces, city_id,
          reservation_appareils ( appareil:appareils ( numero ) ),
          client:clients ( acces_difficile )
        )
      `)
      .eq('transporteur_id', transporteurId)
      .eq('masquee', false)
      .or(`statut.in.(a_faire,acceptee,arrivee,probleme),and(statut.eq.fait,date_prevue.gte.${cutoffStr})`)
      .order('date_prevue', { ascending: true })
      .order('creneau', { ascending: true });
    if (error) throw error;

    const [baremeByCity, tData] = await Promise.all([
      getBaremeByCityIds(supabase, (data || []).map(m => m.reservation?.city_id)),
      supabase.from('transporteurs').select('en_pause').eq('id', transporteurId).maybeSingle(),
    ]);

    const missions = (data || []).map(m => ({
      id:                  m.id,
      type:                m.type,
      installation:        m.reservation?.installation || null,
      // "autre" : pas de barème, le tarif est fixé une fois pour toutes par
      // l'admin à la création (montant_du_cents), jamais recalculé ici.
      montant_preview:     m.type === 'autre' ? (m.montant_du_cents || 0) : computeBareme(m.type, m.reservation?.installation, baremeByCity[m.reservation?.city_id]),
      statut:              m.statut,
      date_prevue:         m.date_prevue,
      creneau:             m.creneau,
      titre:               m.titre || null,
      adresse_libre:       m.adresse_libre || null,
      photo_depart_ok:     Boolean(m.photo_depart_path),
      photo_installation_ok: Boolean(m.photo_installation_path),
      photo_retour_ok:     Boolean(m.photo_retour_path),
      demo_faite:          Boolean(m.demo_faite),
      vidange_ok:          Boolean(m.vidange_confirmee),
      client_notifie:      Boolean(m.client_notifie_at),
      fenetre_photo_ok:    Boolean(m.reservation?.fenetre_photo_path),
      probleme_type:       m.probleme_type,
      probleme_description: m.probleme_description,
      incident_id:         m.incident_id,
      appareil_numeros: ((m.reservation?.reservation_appareils) || [])
        .map(ra => ra.appareil?.numero).filter(n => n != null).sort((a, b) => a - b),
      acces_difficile: m.reservation?.client?.acces_difficile || null,
      client: m.reservation || null,
    }));

    return res.status(200).json({ missions, en_pause: tData?.data?.en_pause || false });
  } catch (err) {
    console.error('[Transporteur missions]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
