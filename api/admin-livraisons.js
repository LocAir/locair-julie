const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity } = require('./_lib/city');
const { checkAdminToken } = require('./_lib/auth');
const { pushToTransporteur } = require('./_lib/push');

const MEDIA_COLUMN = {
  photo_depart:       'photo_depart_path',
  photo_installation: 'photo_installation_path',
  photo_retour:       'photo_retour_path',
  photo_absence:      'photo_absence_path',
};
// Charge une livraison en vérifiant qu'elle appartient bien à la ville de
// l'admin authentifié — empêche d'agir sur une mission d'une autre ville en
// devinant son id, une fois plusieurs villes sur la même base Supabase. Une
// mission "autre" (hors réservation) porte sa ville directement (city_id) ;
// une mission normale la tire de sa réservation.
async function loadLivraisonScoped(supabase, cityId, livraisonId, select) {
  const { data } = await supabase
    .from('livraisons').select(`${select}, city_id, reservation:reservations ( city_id )`)
    .eq('id', livraisonId).maybeSingle();
  if (!data) return null;
  const belongsToCity = data.reservation ? data.reservation.city_id === cityId : data.city_id === cityId;
  if (!belongsToCity) return null;
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
    const city = await resolveAdminCity(supabase, body);
    if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });

    if (action === 'list') {
      // livraisons n'a pas de city_id direct pour une mission normale — on passe
      // par les réservations de cette ville pour ne jamais faire fuiter les
      // missions d'une autre ville partageant la même base Supabase. Une
      // mission "autre" (hors réservation) porte sa ville directement.
      const { data: cityResas } = await supabase.from('reservations').select('id').eq('city_id', city.id);
      const resaIds = (cityResas || []).map(r => r.id);

      const selectCols = `
          id, type, statut, date_prevue, creneau, masquee, titre, adresse_libre, montant_du_cents,
          probleme_type, probleme_description,
          photo_depart_path, photo_installation_path, photo_retour_path, photo_absence_path,
          accepted_at, client_notifie_at, arrivee_at, fait_at,
          vidange_confirmee, vidange_at,
          transporteur:transporteurs ( id, nom ),
          reservation:reservations (
            id, ref, prenom, nom, tel, adresse, etage, ascenseur, fenetre, instructions_acces, masquee, hors_zone,
            reservation_appareils ( appareil:appareils ( numero, reference ) )
          )
        `;
      const queries = [];
      if (resaIds.length) {
        queries.push(supabase.from('livraisons').select(selectCols).in('reservation_id', resaIds).order('date_prevue', { ascending: false }).limit(300));
      }
      queries.push(supabase.from('livraisons').select(selectCols).eq('type', 'autre').eq('city_id', city.id).order('date_prevue', { ascending: false }).limit(100));
      const results = await Promise.all(queries);
      for (const r of results) if (r.error) throw r.error;
      const data = results.flatMap(r => r.data || []);

      // Une réservation masquée (ex. doublon retiré de l'écran par l'admin) sort
      // aussi de la liste des missions — sans quoi ses livraisons/récupérations
      // continuent d'encombrer cet onglet alors que la réservation a disparu de
      // l'onglet Réservations.
      const livraisons = data.filter(l => !l.reservation?.masquee).map(l => {
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
      }).sort((a, b) => b.date_prevue.localeCompare(a.date_prevue));
      return res.status(200).json({ livraisons });
    }

    if (action === 'create') {
      const type = body.type;
      if (!['livraison', 'recuperation', 'changement', 'autre'].includes(type)) {
        return res.status(400).json({ error: 'Type invalide (livraison | recuperation | changement | autre)' });
      }

      // Mission "autre" : pas de réservation, pas de barème — l'admin fixe le
      // titre, l'adresse et le tarif lui-même (ex. aller chercher du matériel
      // livré par un fournisseur et le ramener au box).
      if (type === 'autre') {
        // Aucun champ obligatoire : une mission créée avec le strict minimum
        // (juste le tarif et le jour) reste utile — le reste se complète plus
        // tard depuis la liste si besoin.
        const titre = (body.titre || '').trim().slice(0, 200) || 'Mission libre';
        const adresseLibre = (body.adresse_libre || '').trim().slice(0, 500);
        let datePrevueAutre = (body.date_prevue || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(datePrevueAutre)) datePrevueAutre = new Date().toISOString().slice(0, 10);
        const transporteurIdAutre = body.transporteur_id ? parseInt(body.transporteur_id) : null;
        if (transporteurIdAutre) {
          const { data: t } = await supabase.from('transporteurs').select('id').eq('id', transporteurIdAutre).eq('city_id', city.id).maybeSingle();
          if (!t) return res.status(400).json({ error: 'Transporteur invalide' });
        }
        const montantCents = Math.max(0, parseInt(body.montant_du_cents) || 0);

        const { data, error } = await supabase.from('livraisons').insert({
          type: 'autre', city_id: city.id, titre, adresse_libre: adresseLibre || null,
          transporteur_id: transporteurIdAutre, date_prevue: datePrevueAutre,
          creneau: (body.creneau || '').trim().slice(0, 100) || null,
          statut: 'a_faire', montant_du_cents: montantCents,
        }).select().single();
        if (error) throw error;

        if (transporteurIdAutre) {
          await pushToTransporteur(supabase, transporteurIdAutre, {
            title: "Nouvelle mission Loc'Air",
            body:  `${titre} — ouvre l'app pour l'accepter ou la refuser.`,
            tag:   'nouvelle-mission',
          });
        }
        return res.status(200).json({ ok: true, livraison: data });
      }

      const reservationId  = parseInt(body.reservation_id);
      const transporteurId = body.transporteur_id ? parseInt(body.transporteur_id) : null;
      const datePrevue     = (body.date_prevue || '').slice(0, 10);
      const creneau        = (body.creneau || '').trim().slice(0, 100) || null;

      if (!reservationId) return res.status(400).json({ error: 'reservation_id manquant' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datePrevue)) return res.status(400).json({ error: 'date_prevue invalide (YYYY-MM-DD)' });

      const { data: resa } = await supabase
        .from('reservations').select('id, city_id, date_debut, date_fin').eq('id', reservationId).maybeSingle();
      if (!resa || resa.city_id !== city.id) return res.status(404).json({ error: 'Réservation introuvable' });

      if (transporteurId) {
        const { data: t } = await supabase.from('transporteurs').select('id').eq('id', transporteurId).eq('city_id', city.id).maybeSingle();
        if (!t) return res.status(400).json({ error: 'Transporteur invalide' });
      }

      // Assignation manuelle d'une unité (climatiseur) à cette mission — surtout
      // utile pour un 'changement' (remplacement physique) créé à la main, cas
      // que la confirmation automatique de réservation ne couvre pas puisqu'elle
      // n'assigne qu'une fois, à la confirmation initiale.
      const appareilId = body.appareil_id ? parseInt(body.appareil_id) : null;
      if (appareilId) {
        const { data: appareil } = await supabase
          .from('appareils').select('id, statut').eq('id', appareilId).eq('city_id', city.id).maybeSingle();
        if (!appareil) return res.status(400).json({ error: 'Unité introuvable' });
        if (['panne', 'maintenance', 'loue'].includes(appareil.statut)) {
          return res.status(409).json({ error: 'Cette unité n\'est pas disponible' });
        }
        // Même logique d'exclusion que assign_appareils() : refuser une unité déjà
        // retenue par une AUTRE réservation confirmée dont la période chevauche.
        const { data: liens } = await supabase
          .from('reservation_appareils')
          .select('reservation_id, reservation:reservations(statut, date_debut, date_fin)')
          .eq('appareil_id', appareilId).neq('reservation_id', reservationId);
        const busy = (liens || []).some(l => l.reservation?.statut === 'confirmee'
          && l.reservation.date_debut < resa.date_fin && l.reservation.date_fin > resa.date_debut);
        if (busy) return res.status(409).json({ error: 'Cette unité est déjà affectée à une autre réservation sur cette période' });

        // Un remplacement libère l'ancienne unité de la réservation (elle redevient
        // disponible au stock) et attache la nouvelle à sa place.
        if (type === 'changement') {
          await supabase.from('reservation_appareils').delete().eq('reservation_id', reservationId);
        }
        const { error: raErr } = await supabase
          .from('reservation_appareils')
          .upsert({ reservation_id: reservationId, appareil_id: appareilId }, { onConflict: 'reservation_id,appareil_id' });
        if (raErr) throw raErr;
      }

      const { data, error } = await supabase.from('livraisons').insert({
        reservation_id:  reservationId,
        transporteur_id: transporteurId || null,
        type,
        date_prevue:     datePrevue,
        creneau,
        statut:          'a_faire',
      }).select().single();
      if (error) throw error;

      if (transporteurId) {
        await pushToTransporteur(supabase, transporteurId, {
          title: "Nouvelle mission Loc'Air",
          body:  'Une mission t\'attend — ouvre l\'app pour l\'accepter ou la refuser.',
          tag:   'nouvelle-mission',
        });
      }

      return res.status(200).json({ ok: true, livraison: data });
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
      // Une mission terminée ou annulée ne change plus de transporteur : le
      // montant dû lui est déjà rattaché (admin-virements.js) — réaffecter
      // changerait silencieusement qui est payé pour un travail déjà fait.
      if (['fait', 'annule'].includes(liv.statut)) {
        return res.status(400).json({ error: 'Mission terminée ou annulée : transporteur non modifiable' });
      }
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

    // Équivalent admin du bouton "⏪ Faire plus tard" côté transporteur —
    // remet la mission en attente d'acceptation pour le MÊME transporteur
    // (contrairement à 'assign' vers un autre transporteur), sans perdre une
    // éventuelle progression déjà enregistrée (photo, vidange).
    if (action === 'remettre_a_faire') {
      const livraisonId = parseInt(body.livraison_id);
      if (!livraisonId) return res.status(400).json({ error: 'livraison_id manquant' });
      const liv = await loadLivraisonScoped(supabase, city.id, livraisonId, 'id, statut, transporteur_id');
      if (!liv) return res.status(404).json({ error: 'Mission introuvable' });
      if (!['acceptee', 'arrivee'].includes(liv.statut)) {
        return res.status(409).json({ error: 'Cette mission n\'est pas en cours' });
      }
      await supabase.from('livraisons').update({ statut: 'a_faire', accepted_at: null, arrivee_at: null }).eq('id', liv.id);
      if (liv.transporteur_id) {
        await pushToTransporteur(supabase, liv.transporteur_id, {
          title: 'Mission remise à faire',
          body:  'Une mission a été remise en attente d\'acceptation — ouvre l\'app pour la revoir.',
          tag:   'nouvelle-mission',
        });
      }
      return res.status(200).json({ ok: true });
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
