const { getSupabase } = require('./_lib/supabase');
const { getCity }     = require('./_lib/city');
const { checkAdminToken } = require('./_lib/auth');
const { pushToTransporteur } = require('./_lib/push');

const MEDIA_COLUMN = {
  photo_depart:       'photo_depart_path',
  photo_installation: 'photo_installation_path',
  photo_retour:       'photo_retour_path',
  photo_absence:      'photo_absence_path',
};

// Charge une livraison en vérifiant qu'elle appartient bien (via sa réservation)
// à la ville de l'admin authentifié — empêche d'agir sur une mission d'une autre
// ville en devinant son id, une fois plusieurs villes sur la même base Supabase.
async function loadLivraisonScoped(supabase, cityId, livraisonId, select) {
  const { data } = await supabase
    .from('livraisons').select(`${select}, reservation:reservations ( city_id )`)
    .eq('id', livraisonId).maybeSingle();
  if (!data || !data.reservation || data.reservation.city_id !== cityId) return null;
  delete data.reservation;
  return data;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    const city = await getCity(supabase);

    if (action === 'list') {
      // livraisons n'a pas de city_id direct — on passe par les réservations de
      // cette ville pour ne jamais faire fuiter les missions d'une autre ville
      // partageant la même base Supabase.
      const { data: cityResas } = await supabase.from('reservations').select('id').eq('city_id', city.id);
      const resaIds = (cityResas || []).map(r => r.id);
      if (!resaIds.length) return res.status(200).json({ livraisons: [] });

      const { data, error } = await supabase
        .from('livraisons')
        .select(`
          id, type, statut, date_prevue, creneau, masquee,
          probleme_type, probleme_description,
          photo_depart_path, photo_installation_path, photo_retour_path, photo_absence_path,
          accepted_at, client_notifie_at, arrivee_at, fait_at,
          transporteur:transporteurs ( id, nom ),
          reservation:reservations (
            id, ref, prenom, nom, tel, adresse, etage, ascenseur, fenetre, instructions_acces, masquee,
            reservation_appareils ( appareil:appareils ( numero, reference ) )
          )
        `)
        .in('reservation_id', resaIds)
        .order('date_prevue', { ascending: false })
        .limit(300);
      if (error) throw error;
      // Une réservation masquée (ex. doublon retiré de l'écran par l'admin) sort
      // aussi de la liste des missions — sans quoi ses livraisons/récupérations
      // continuent d'encombrer cet onglet alors que la réservation a disparu de
      // l'onglet Réservations.
      const livraisons = (data || []).filter(l => !l.reservation?.masquee).map(l => {
        const ras = ((l.reservation?.reservation_appareils) || [])
          .filter(ra => ra.appareil?.numero != null)
          .sort((a, b) => a.appareil.numero - b.appareil.numero);
        // Durées calculées à partir des horodatages posés automatiquement par le
        // parcours du livreur (aucune action dédiée requise) : le temps de trajet
        // dépôt→client, et le temps passé sur place (installation ou
        // vérification/vidange) — utile pour objectiver des hypothèses comme
        // "20-30 min d'installation" avec de la vraie donnée.
        const minsBetween = (a, b) => (a && b) ? Math.round((new Date(b) - new Date(a)) / 60000) : null;
        return {
          ...l,
          appareil_numeros: ras.map(ra => ra.appareil.numero),
          appareil_references: ras.map(ra => ra.appareil.reference).filter(Boolean),
          duree_trajet_min:    minsBetween(l.accepted_at, l.arrivee_at),
          duree_sur_place_min: minsBetween(l.arrivee_at, l.fait_at),
        };
      });
      return res.status(200).json({ livraisons });
    }

    if (action === 'resolve_probleme') {
      const livraisonId = parseInt(body.livraison_id);
      if (!livraisonId) return res.status(400).json({ error: 'livraison_id manquant' });
      const liv = await loadLivraisonScoped(supabase, city.id, livraisonId, 'id, statut, reservation_id');
      if (!liv) return res.status(404).json({ error: 'Mission introuvable' });
      if (liv.statut !== 'probleme') return res.status(409).json({ error: 'Cette mission n\'est pas signalée en problème' });

      // Remet la mission à l'étape "acceptée" : le livreur doit repasser par "arrivé"
      // (sans reperdre les preuves déjà prises) avant de pouvoir la terminer.
      await supabase.from('livraisons').update({
        statut: 'acceptee', probleme_type: null, probleme_description: null, probleme_at: null,
      }).eq('id', liv.id);

      if (liv.reservation_id) {
        await supabase.from('incidents').update({ statut: 'resolu' })
          .eq('reservation_id', liv.reservation_id).eq('statut', 'ouvert');
      }

      return res.status(200).json({ ok: true });
    }

    if (action === 'assign') {
      const livraisonId    = parseInt(body.livraison_id);
      const transporteurId = body.transporteur_id ? parseInt(body.transporteur_id) : null;
      if (!livraisonId) return res.status(400).json({ error: 'livraison_id manquant' });

      const liv = await loadLivraisonScoped(supabase, city.id, livraisonId, 'transporteur_id, statut');
      if (!liv) return res.status(404).json({ error: 'Mission introuvable' });
      if (transporteurId) {
        const { data: t } = await supabase.from('transporteurs').select('id').eq('id', transporteurId).eq('city_id', city.id).maybeSingle();
        if (!t) return res.status(400).json({ error: 'Transporteur invalide' });
      }
      const patch = { transporteur_id: transporteurId };
      // Réassigner une mission déjà en cours (ex. livreur indisponible en cours de
      // route) à un AUTRE transporteur la remet à "à faire" : le nouveau livreur
      // doit repasser par "j'accepte" plutôt que d'hériter d'une étape qu'il n'a
      // pas vécue. Les preuves déjà prises (photo/vidéo) sont conservées.
      const enCours = liv && ['acceptee', 'arrivee', 'probleme'].includes(liv.statut);
      if (enCours && liv.transporteur_id !== transporteurId) {
        Object.assign(patch, {
          statut: 'a_faire', accepted_at: null, arrivee_at: null,
          probleme_at: null, probleme_type: null, probleme_description: null,
        });
      }
      const { error } = await supabase.from('livraisons').update(patch).eq('id', livraisonId);
      if (error) throw error;

      // Prévenir les deux côtés d'une réaffectation, même téléphone fermé :
      // le nouveau transporteur (nouvelle mission à traiter) ET l'ancien s'il
      // en avait une (mission qui lui a été retirée — sans ça il continue de
      // la croire sienne jusqu'à rouvrir l'app). Attendu explicitement : une
      // fonction serverless peut être coupée juste après la réponse HTTP, un
      // push "fire-and-forget" risquerait de ne jamais partir.
      if (transporteurId && transporteurId !== liv.transporteur_id) {
        await pushToTransporteur(supabase, transporteurId, {
          title: "Nouvelle mission Loc'Air",
          body:  'Une mission t\'attend — ouvre l\'app pour l\'accepter ou la refuser.',
          tag:   'nouvelle-mission',
        });
      }
      if (liv.transporteur_id && liv.transporteur_id !== transporteurId) {
        await pushToTransporteur(supabase, liv.transporteur_id, {
          title: 'Mission réattribuée',
          body:  'Une mission qui t\'était assignée a été confiée à quelqu\'un d\'autre.',
          tag:   'mission-reattribuee',
        });
      }

      return res.status(200).json({ ok: true, reset: patch.statut === 'a_faire' });
    }

    if (action === 'mask') {
      // Retire une mission de l'écran Livraisons (ménage manuel, ex. doublon ou
      // vieille mission annulée qui traîne) — n'importe quel statut, y compris
      // "annulee"/"fait". Ne touche ni au statut ni aux données réelles,
      // réversible via masquee=false.
      const livraisonId = parseInt(body.livraison_id);
      if (!livraisonId) return res.status(400).json({ error: 'livraison_id manquant' });
      const liv = await loadLivraisonScoped(supabase, city.id, livraisonId, 'id');
      if (!liv) return res.status(404).json({ error: 'Mission introuvable' });
      const { error } = await supabase.from('livraisons').update({ masquee: !!body.masquee }).eq('id', livraisonId);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'position') {
      const transporteurId = parseInt(body.transporteur_id);
      if (!transporteurId) return res.status(400).json({ error: 'transporteur_id manquant' });
      const { data: t, error } = await supabase
        .from('transporteurs').select('nom, position_lat, position_lng, position_at')
        .eq('id', transporteurId).eq('city_id', city.id).maybeSingle();
      if (error) throw error;
      if (!t || t.position_lat == null) return res.status(404).json({ error: 'Pas encore de position' });
      return res.status(200).json({ nom: t.nom, lat: t.position_lat, lng: t.position_lng, position_at: t.position_at });
    }

    if (action === 'media_url') {
      const livraisonId = parseInt(body.livraison_id);
      const kind = body.kind;
      const column = MEDIA_COLUMN[kind];
      if (!livraisonId || !column) return res.status(400).json({ error: 'Paramètres invalides' });
      const liv = await loadLivraisonScoped(supabase, city.id, livraisonId, column);
      if (!liv || !liv[column]) return res.status(404).json({ error: 'Média introuvable' });
      const { data, error } = await supabase.storage.from('missions').createSignedUrl(liv[column], 300);
      if (error) throw error;
      return res.status(200).json({ url: data.signedUrl });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin livraisons]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
