const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity, notifyIfSoldOut } = require('./_lib/city');
const { getAvailability } = require('./_lib/stock');
const { checkAdminToken } = require('./_lib/auth');
const { recordMouvement } = require('./_lib/stockMouvements');
const { computeParcDashboard } = require('./_lib/parcDashboard');

// Compteur de secours pour l'Offre Privilège (Module 7) : nb_locations se
// calcule normalement en comptant les lignes reservation_appareils d'un
// appareil, mais un échange/réaffectation (ci-dessous) supprime la ligne de
// l'ancien appareil pour garder l'état "actuel" propre — ce qui effaçait
// silencieusement cette location du décompte. On la garde ici avant de la
// perdre, pour que le seuil d'éligibilité (SEUIL_OFFRE) reste exact même
// pour un appareil souvent échangé.
// Marqueur du mouvement posé par l'action 'log_controle' (entretien
// préventif, Module 8) — même principe que le marqueur d'alerte de
// cron-daily.js : un texte identifiable dans commentaire plutôt qu'une
// nouvelle colonne.
const CONTROLE_MARQUEUR = 'Contrôle préventif effectué';
const CONTROLE_SEUIL_MOIS = 6;

async function bumpNbLocationsHistorique(supabase, appareilId) {
  const { data } = await supabase.from('appareils').select('nb_locations_historique').eq('id', appareilId).maybeSingle();
  await supabase.from('appareils').update({ nb_locations_historique: (data?.nb_locations_historique || 0) + 1 }).eq('id', appareilId);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    // Catalogue des modèles de climatiseur (voir espace client, Module 4) —
    // global, pas rattaché à une ville, donc traité avant la résolution de
    // ville ci-dessous.
    if (action === 'modeles_list') {
      const { data, error } = await supabase.from('modeles_climatiseur').select('*').order('marque').order('modele');
      if (error) throw error;
      return res.status(200).json({ modeles: data || [] });
    }
    if (action === 'modele_upsert') {
      const id = parseInt(body.id) || null;
      const row = {
        marque:               (body.marque || '').trim().slice(0, 100),
        modele:               (body.modele || '').trim().slice(0, 100),
        puissance_btu:        (body.puissance_btu || '').trim().slice(0, 100) || null,
        surface_max_m2:       (body.surface_max_m2 || '').trim().slice(0, 100) || null,
        niveau_sonore_db:     (body.niveau_sonore_db || '').trim().slice(0, 100) || null,
        classe_energie:       (body.classe_energie || '').trim().slice(0, 20) || null,
        photo_url:            (body.photo_url || '').trim().slice(0, 500) || null,
        conseils_utilisation: (body.conseils_utilisation || '').trim().slice(0, 2000) || null,
        video_tutoriel_url:   (body.video_tutoriel_url || '').trim().slice(0, 500) || null,
        documentation_url:    (body.documentation_url || '').trim().slice(0, 500) || null,
        actif:                body.actif !== false,
      };
      if (!row.marque || !row.modele) return res.status(400).json({ error: 'Marque et modèle requis' });
      const { error } = id
        ? await supabase.from('modeles_climatiseur').update(row).eq('id', id)
        : await supabase.from('modeles_climatiseur').insert(row);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    const city = await resolveAdminCity(supabase, body);
    if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });

    if (action === 'add') {
      // Ajout en lot (Module 9) : un parc qui grandit vers plusieurs
      // centaines d'unités ne peut pas être constitué un par un.
      const quantite = Math.min(500, Math.max(1, parseInt(body.quantite) || 1));
      const { data: maxRow } = await supabase
        .from('appareils').select('numero').eq('city_id', city.id)
        .order('numero', { ascending: false }).limit(1).maybeSingle();
      const numeroDepart = (maxRow?.numero || 0) + 1;
      const rows = Array.from({ length: quantite }, (_, i) => ({ city_id: city.id, numero: numeroDepart + i }));
      const { data, error } = await supabase
        .from('appareils').insert(rows).select();
      if (error) throw error;
      // Mouvement de stock (Module 6, Partie 5) : entrée dans le parc.
      await supabase.from('appareil_mouvements').insert(data.map(a => ({
        appareil_id: a.id, type_evenement: 'entree_parc',
        ancien_statut: null, nouveau_statut: a.statut,
        ancienne_localisation: null, nouvelle_localisation: a.localisation,
        utilisateur: 'admin',
      })));
      return res.status(200).json({ ok: true, appareils: data });
    }

    if (action === 'update') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const patch = {};
      if (body.statut != null) {
        if (!['disponible', 'panne', 'maintenance', 'loue', 'nettoyage'].includes(body.statut)) {
          return res.status(400).json({ error: 'Statut invalide' });
        }
        patch.statut = body.statut;
      }
      if (body.reference != null) patch.reference = body.reference.trim().slice(0, 200) || null;
      if (body.notes != null) patch.notes = body.notes.trim().slice(0, 1000) || null;
      if (body.modele_id != null) patch.modele_id = parseInt(body.modele_id) || null;
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Rien à modifier' });
      // Vérifie l'appartenance à cette ville AVANT tout écriture (recordMouvement
      // n'a pas connaissance de la ville, contrairement à l'update ci-dessous).
      const { data: owned } = await supabase.from('appareils').select('id').eq('id', id).eq('city_id', city.id).maybeSingle();
      if (!owned) return res.status(404).json({ error: 'Unité introuvable' });
      const statutChange = patch.statut != null;
      if (statutChange) {
        // Changement de statut manuel par l'admin -> mouvement de stock
        // (Module 6, Partie 5) avec justification (Partie 9), plutôt qu'un
        // update() muet.
        const localisationByStatut = {
          disponible: 'stock_principal', nettoyage: 'stock_principal',
          maintenance: 'maintenance', panne: 'maintenance', loue: 'chez_client',
        };
        const isMaintenance = ['maintenance', 'panne'].includes(patch.statut);
        await recordMouvement(supabase, {
          appareilId: id,
          typeEvenement: ['disponible'].includes(patch.statut) ? 'remise_disponibilite'
            : isMaintenance ? 'passage_maintenance' : 'autre',
          nouveauStatut: patch.statut,
          nouvelleLocalisation: localisationByStatut[patch.statut] || 'autre',
          utilisateur: 'admin',
          commentaire: (body.justification || '').trim().slice(0, 1000) || null,
          coutCents: isMaintenance && body.cout_cents != null ? Math.max(0, parseInt(body.cout_cents) || 0) : null,
        });
        delete patch.statut; // déjà appliqué par recordMouvement
      }
      if (Object.keys(patch).length) {
        const { error } = await supabase.from('appareils').update(patch).eq('id', id).eq('city_id', city.id);
        if (error) throw error;
      }
      // Un appareil mis en panne/maintenance/loué réduit le stock actif — le
      // trigger SQL a déjà recalculé sold_out au moment de ce même UPDATE,
      // reste à alerter Aly si ça vient de faire passer la ville à "complet".
      if (statutChange) await notifyIfSoldOut(supabase, city.id);
      return res.status(200).json({ ok: true });
    }

    // Historique des mouvements d'un appareil précis (Module 6, Partie 5).
    if (action === 'mouvements_list') {
      const appareilId = parseInt(body.appareil_id);
      if (!appareilId) return res.status(400).json({ error: 'appareil_id manquant' });
      const { data: owned } = await supabase.from('appareils').select('id').eq('id', appareilId).eq('city_id', city.id).maybeSingle();
      if (!owned) return res.status(404).json({ error: 'Unité introuvable' });
      const { data, error } = await supabase
        .from('appareil_mouvements')
        .select('id, type_evenement, ancien_statut, nouveau_statut, ancienne_localisation, nouvelle_localisation, utilisateur, commentaire, created_at, livraison_id, reservation_id')
        .eq('appareil_id', appareilId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return res.status(200).json({ mouvements: data || [] });
    }

    // Tableau de bord du parc (Module 6, Partie 9).
    if (action === 'dashboard') {
      return res.status(200).json(await computeParcDashboard(supabase, city.id));
    }

    // Fiche administrateur d'un climatiseur (Module 6, Partie 9) : historique,
    // réservations associées, clients précédents, missions transporteur liées,
    // incidents, interventions maintenance, état actuel.
    if (action === 'detail') {
      const appareilId = parseInt(body.appareil_id);
      if (!appareilId) return res.status(400).json({ error: 'appareil_id manquant' });
      const { data: appareil } = await supabase.from('appareils').select('*').eq('id', appareilId).eq('city_id', city.id).maybeSingle();
      if (!appareil) return res.status(404).json({ error: 'Unité introuvable' });

      const [{ data: mouvements }, { data: liens }] = await Promise.all([
        supabase.from('appareil_mouvements')
          .select('id, type_evenement, ancien_statut, nouveau_statut, ancienne_localisation, nouvelle_localisation, utilisateur, commentaire, cout_cents, created_at, livraison_id, reservation_id')
          .eq('appareil_id', appareilId).order('created_at', { ascending: false }).limit(200),
        supabase.from('reservation_appareils').select('reservation_id').eq('appareil_id', appareilId),
      ]);
      const resaIds = [...new Set((liens || []).map(l => l.reservation_id))];

      let reservations = [], incidents = [], missions = [];
      if (resaIds.length) {
        const [{ data: resas }, { data: incs }, { data: livs }] = await Promise.all([
          supabase.from('reservations').select('id, ref, prenom, nom, tel, email, date_debut, date_fin, statut, prix_total_cents, quantite').in('id', resaIds).order('date_debut', { ascending: false }),
          supabase.from('incidents').select('id, type, description, statut, created_at, transporteur:transporteurs(nom)').in('reservation_id', resaIds).order('created_at', { ascending: false }),
          supabase.from('livraisons').select('id, type, statut, date_prevue, fait_at, reservation_id, transporteur:transporteurs(nom)').in('reservation_id', resaIds).order('date_prevue', { ascending: false }),
        ]);
        reservations = resas || [];
        incidents = incs || [];
        missions = livs || [];
      }
      // Clients précédents = clients distincts des réservations associées.
      const clients = [...new Map(reservations.map(r => [
        [r.prenom, r.nom, r.tel].join('|'),
        { prenom: r.prenom, nom: r.nom, tel: r.tel, email: r.email },
      ])).values()];

      return res.status(200).json({
        appareil, mouvements: mouvements || [], reservations, clients, missions, incidents,
        interventions_maintenance: (mouvements || []).filter(m => m.type_evenement === 'passage_maintenance'),
      });
    }

    // Rentabilité / statistiques par climatiseur (Module 6, Partie 10).
    if (action === 'stats') {
      const appareilId = parseInt(body.appareil_id);
      if (!appareilId) return res.status(400).json({ error: 'appareil_id manquant' });
      const { data: appareil } = await supabase.from('appareils').select('id, created_at').eq('id', appareilId).eq('city_id', city.id).maybeSingle();
      if (!appareil) return res.status(404).json({ error: 'Unité introuvable' });

      const { data: liens } = await supabase.from('reservation_appareils').select('reservation_id').eq('appareil_id', appareilId);
      const resaIds = [...new Set((liens || []).map(l => l.reservation_id))];
      let locations = [];
      if (resaIds.length) {
        const { data: resas } = await supabase
          .from('reservations').select('id, date_debut, date_fin, prix_total_cents, quantite, statut')
          .in('id', resaIds).in('statut', ['confirmee', 'terminee']);
        locations = resas || [];
      }
      const joursLoues = locations.reduce((s, r) => s + Math.max(0, (new Date(r.date_fin) - new Date(r.date_debut)) / 86400000), 0);
      // CA proraté par appareil si la réservation en couvre plusieurs — une
      // estimation raisonnable, pas une comptabilité exacte par numéro de série.
      const caCents = locations.reduce((s, r) => s + Math.round((r.prix_total_cents || 0) / (r.quantite || 1)), 0);

      const { data: maintenances } = await supabase
        .from('appareil_mouvements').select('cout_cents').eq('appareil_id', appareilId).eq('type_evenement', 'passage_maintenance');
      const coutMaintenanceCents = (maintenances || []).reduce((s, m) => s + (m.cout_cents || 0), 0);

      const joursDepuisEntree = Math.max(1, (Date.now() - new Date(appareil.created_at).getTime()) / 86400000);
      const moisDepuisEntree = Math.max(1, joursDepuisEntree / 30);

      return res.status(200).json({
        nombre_locations: locations.length,
        jours_loues: Math.round(joursLoues),
        ca_genere_euros: caCents / 100,
        cout_maintenance_euros: coutMaintenanceCents / 100,
        rentabilite_estimee_euros: (caCents - coutMaintenanceCents) / 100,
        taux_utilisation: Math.min(1, joursLoues / joursDepuisEntree),
        duree_moyenne_location_jours: locations.length ? Math.round(joursLoues / locations.length) : 0,
        frequence_rotation_par_mois: Math.round((locations.length / moisDepuisEntree) * 100) / 100,
      });
    }

    // Entretien préventif (Module 8) — le seuil d'usage (MAINTENANCE_SEUIL)
    // existe déjà côté cron (cron-daily.js) mais seulement en push, jamais
    // visible dans l'app. On y ajoute ici une notion calendaire ("pas vérifié
    // depuis 6 mois") en réutilisant appareil_mouvements comme journal des
    // contrôles — un passage en maintenance compte, ou le marqueur posé par
    // l'action 'log_controle' ci-dessous quand tout était OK — sans nouvelle
    // colonne ni nouveau type d'événement.
    if (action === 'entretien_liste') {
      const SEUIL = parseInt(process.env.MAINTENANCE_SEUIL) || 15;
      const seuilDate = new Date(Date.now() - CONTROLE_SEUIL_MOIS * 30 * 86400000).toISOString();
      const { data: appareils } = await supabase
        .from('appareils').select('id, numero, created_at').eq('city_id', city.id).eq('statut', 'disponible');

      const items = [];
      for (const app of appareils || []) {
        const [{ count: nbLocations }, { data: mouvements }] = await Promise.all([
          supabase.from('reservation_appareils').select('id', { count: 'exact', head: true }).eq('appareil_id', app.id),
          supabase.from('appareil_mouvements').select('type_evenement, commentaire, created_at')
            .eq('appareil_id', app.id).in('type_evenement', ['passage_maintenance', 'autre'])
            .order('created_at', { ascending: false }).limit(20),
        ]);
        const dernierControle = (mouvements || []).find(m => m.type_evenement === 'passage_maintenance' || (m.commentaire || '').startsWith(CONTROLE_MARQUEUR));

        const usageDepasse = (nbLocations || 0) >= SEUIL;
        const controleAncien = !dernierControle || dernierControle.created_at < seuilDate;
        if (usageDepasse || controleAncien) {
          items.push({
            appareil_id: app.id,
            numero: app.numero,
            nombre_locations: nbLocations || 0,
            dernier_controle: dernierControle ? dernierControle.created_at : null,
            raison: usageDepasse ? 'usage' : 'calendaire',
          });
        }
      }
      return res.status(200).json({ items });
    }

    // Journalise un contrôle préventif effectué (rien à signaler) — ne change
    // ni le statut ni la localisation, juste une trace datée qui compte comme
    // "dernier entretien" pour entretien_liste ci-dessus.
    if (action === 'log_controle') {
      const appareilId = parseInt(body.appareil_id);
      if (!appareilId) return res.status(400).json({ error: 'appareil_id manquant' });
      const { data: appareil } = await supabase.from('appareils').select('id, statut, localisation').eq('id', appareilId).eq('city_id', city.id).maybeSingle();
      if (!appareil) return res.status(404).json({ error: 'Unité introuvable' });
      await recordMouvement(supabase, {
        appareilId, typeEvenement: 'autre',
        nouveauStatut: appareil.statut, nouvelleLocalisation: appareil.localisation,
        utilisateur: 'admin', commentaire: CONTROLE_MARQUEUR,
      });
      return res.status(200).json({ ok: true });
    }

    // Réaffectation manuelle d'un appareil précis à une réservation (Partie 9,
    // "affecter un appareil") — remplace l'appareil retenu par assign_appareils
    // sans toucher au reste du parcours (mission déjà créée, statut inchangé).
    if (action === 'reassign') {
      const reservationId = parseInt(body.reservation_id);
      // L'admin raisonne en "n° de climatiseur" (étiquette collée dessus),
      // jamais en id interne — accepte les deux pour rester flexible.
      let nouvelAppareilId = parseInt(body.appareil_id) || null;
      if (!nouvelAppareilId && body.appareil_numero != null) {
        const { data: parNumero } = await supabase.from('appareils').select('id').eq('city_id', city.id).eq('numero', parseInt(body.appareil_numero)).maybeSingle();
        nouvelAppareilId = parNumero?.id || null;
      }
      if (!reservationId || !nouvelAppareilId) return res.status(400).json({ error: 'Paramètres manquants ou climatiseur introuvable' });
      const { data: resa } = await supabase.from('reservations').select('id, date_debut, date_fin').eq('id', reservationId).eq('city_id', city.id).maybeSingle();
      if (!resa) return res.status(404).json({ error: 'Réservation introuvable' });
      const { data: nouvelAppareil } = await supabase.from('appareils').select('id, statut').eq('id', nouvelAppareilId).eq('city_id', city.id).maybeSingle();
      if (!nouvelAppareil) return res.status(404).json({ error: 'Nouvel appareil introuvable' });
      if (['panne', 'maintenance', 'nettoyage'].includes(nouvelAppareil.statut)) {
        return res.status(400).json({ error: 'Cet appareil n\'est pas en état d\'être affecté (panne/maintenance/nettoyage)' });
      }
      // Refuse un appareil déjà retenu par une AUTRE réservation confirmée qui
      // chevauche — sauf si l'admin a explicitement demandé un échange
      // (swap:true), auquel cas les deux réservations s'échangent leurs
      // appareils au lieu de bloquer (voir plus bas).
      const { data: conflit } = await supabase
        .from('reservation_appareils')
        .select('id, reservation_id, reservation:reservations(statut, date_debut, date_fin, ref, prenom, nom)')
        .eq('appareil_id', nouvelAppareilId).neq('reservation_id', reservationId);
      const conflitActif = (conflit || []).find(c => c.reservation && c.reservation.statut === 'confirmee'
        && c.reservation.date_debut < resa.date_fin && c.reservation.date_fin > resa.date_debut);

      const { data: ancien } = await supabase.from('reservation_appareils').select('id, appareil_id').eq('reservation_id', reservationId).limit(1).maybeSingle();

      if (conflitActif && !body.swap) {
        return res.status(409).json({
          error: 'Cet appareil est déjà retenu par une autre réservation sur cette période',
          conflit: {
            reservation_id: conflitActif.reservation_id,
            ref: conflitActif.reservation.ref,
            client: [conflitActif.reservation.prenom, conflitActif.reservation.nom].filter(Boolean).join(' '),
          },
        });
      }

      if (conflitActif && body.swap) {
        // Échange : la réservation en conflit récupère l'ancien appareil de
        // celle-ci (si elle en avait un) — sans ça elle se retrouverait sans
        // aucun climatiseur assigné.
        if (!ancien) {
          return res.status(400).json({ error: 'Impossible d\'échanger : cette réservation n\'a pas d\'appareil actuel à donner en retour' });
        }
        const { data: ancienAppareil } = await supabase.from('appareils').select('statut').eq('id', ancien.appareil_id).maybeSingle();
        await bumpNbLocationsHistorique(supabase, nouvelAppareilId);
        await supabase.from('reservation_appareils').delete().eq('id', conflitActif.id);
        await supabase.from('reservation_appareils').insert({ reservation_id: conflitActif.reservation_id, appareil_id: ancien.appareil_id, valide: true, valide_at: new Date().toISOString() });
        await recordMouvement(supabase, {
          // nouveauStatut = statut réel actuel de l'appareil, PAS "disponible" —
          // il reste assigné (à l'autre réservation), il ne redevient pas libre.
          appareilId: ancien.appareil_id, typeEvenement: 'attribution_reservation', nouveauStatut: ancienAppareil?.statut,
          nouvelleLocalisation: 'stock_principal', reservationId: conflitActif.reservation_id,
          utilisateur: 'admin', commentaire: 'Échangé par l\'administration',
        });
      }

      if (ancien) {
        await bumpNbLocationsHistorique(supabase, ancien.appareil_id);
        await supabase.from('reservation_appareils').delete().eq('id', ancien.id);
      }
      await supabase.from('reservation_appareils').insert({ reservation_id: reservationId, appareil_id: nouvelAppareilId, valide: true, valide_at: new Date().toISOString() });

      if (ancien && !conflitActif) {
        await recordMouvement(supabase, {
          appareilId: ancien.appareil_id, typeEvenement: 'autre', nouveauStatut: 'disponible',
          nouvelleLocalisation: 'stock_principal', reservationId,
          utilisateur: 'admin', commentaire: 'Réaffecté à un autre appareil par l\'administration',
        });
      }
      await recordMouvement(supabase, {
        appareilId: nouvelAppareilId, typeEvenement: 'attribution_reservation', nouveauStatut: nouvelAppareil.statut,
        nouvelleLocalisation: 'stock_principal', reservationId,
        utilisateur: 'admin', commentaire: conflitActif ? 'Échangé par l\'administration' : 'Affecté manuellement par l\'administration',
      });

      return res.status(200).json({ ok: true, swapped: Boolean(conflitActif) });
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

    // action 'list' (par défaut) — filtres Partie 9 : statut, modèle,
    // localisation directement sur la requête ; client/transporteur/période
    // passent par une pré-sélection d'appareil_id (jointure sur l'historique).
    let query = supabase.from('appareils').select('*').eq('city_id', city.id);
    if (body.filtre_statut)      query = query.eq('statut', body.filtre_statut);
    if (body.filtre_modele_id)   query = query.eq('modele_id', parseInt(body.filtre_modele_id));
    if (body.filtre_localisation) query = query.eq('localisation', body.filtre_localisation);
    const { data: appareilsRaw, error } = await query.order('numero');
    if (error) throw error;
    let appareils = appareilsRaw || [];

    // Recherche par n° d'appareil ou référence — indispensable pour retrouver
    // une unité précise dans un parc de plusieurs centaines de climatiseurs.
    if (body.filtre_numero) {
      const q = String(body.filtre_numero).trim().toLowerCase();
      appareils = appareils.filter(a =>
        String(a.numero).includes(q) || (a.reference || '').toLowerCase().includes(q));
    }

    if (body.filtre_transporteur_id) {
      const tid = parseInt(body.filtre_transporteur_id);
      const { data: livs } = await supabase
        .from('livraisons').select('reservation_id').eq('transporteur_id', tid);
      const resaIds = [...new Set((livs || []).map(l => l.reservation_id).filter(Boolean))];
      const { data: ras } = resaIds.length
        ? await supabase.from('reservation_appareils').select('appareil_id').in('reservation_id', resaIds)
        : { data: [] };
      const ids = new Set((ras || []).map(r => r.appareil_id));
      appareils = appareils.filter(a => ids.has(a.id));
    }
    if (body.filtre_client) {
      const q = String(body.filtre_client).trim().toLowerCase();
      const { data: resas } = await supabase
        .from('reservations').select('id, prenom, nom, tel, email').eq('city_id', city.id);
      const resaIds = (resas || [])
        .filter(r => [r.prenom, r.nom, r.tel, r.email].filter(Boolean).join(' ').toLowerCase().includes(q))
        .map(r => r.id);
      const { data: ras } = resaIds.length
        ? await supabase.from('reservation_appareils').select('appareil_id').in('reservation_id', resaIds)
        : { data: [] };
      const ids = new Set((ras || []).map(r => r.appareil_id));
      appareils = appareils.filter(a => ids.has(a.id));
    }
    if (body.filtre_periode_debut || body.filtre_periode_fin) {
      const pDebut = body.filtre_periode_debut || '0001-01-01';
      const pFin   = body.filtre_periode_fin || '9999-12-31';
      const { data: resas } = await supabase
        .from('reservations').select('id').eq('city_id', city.id)
        .lt('date_debut', pFin).gt('date_fin', pDebut);
      const resaIds = (resas || []).map(r => r.id);
      const { data: ras } = resaIds.length
        ? await supabase.from('reservation_appareils').select('appareil_id').in('reservation_id', resaIds)
        : { data: [] };
      const ids = new Set((ras || []).map(r => r.appareil_id));
      appareils = appareils.filter(a => ids.has(a.id));
    }

    const today    = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const disponibles = Math.max(0, await getAvailability(supabase, city.id, today, tomorrow));

    // Un appareil est "chez le client" s'il est lié à une réservation confirmée
    // dont la période couvre aujourd'hui. "En préparation" (Partie 7/9) : lié à
    // une réservation confirmée dont la mission de livraison n'est pas encore
    // "fait" — filtré en JS plutôt qu'avec un embed PostgREST filtré (plus
    // simple à garder correct, volume négligeable à cette échelle).
    const [{ data: liens }, { data: livsEnCours }] = await Promise.all([
      supabase.from('reservation_appareils').select('appareil_id, reservation_id, reservation:reservations(statut, date_debut, date_fin)'),
      supabase.from('livraisons').select('reservation_id').eq('type', 'livraison').neq('statut', 'fait'),
    ]);
    const enLocationIds = new Set(
      (liens || [])
        .filter(l => l.reservation && l.reservation.statut === 'confirmee'
          && l.reservation.date_debut <= today && l.reservation.date_fin > today)
        .map(l => l.appareil_id)
    );
    const resaEnPreparationIds = new Set((livsEnCours || []).map(l => l.reservation_id));
    const enPreparationIds = new Set(
      (liens || [])
        .filter(l => l.reservation && l.reservation.statut === 'confirmee' && resaEnPreparationIds.has(l.reservation_id))
        .map(l => l.appareil_id)
    );

    const list = appareils.map(a => ({ ...a, en_location: enLocationIds.has(a.id), en_preparation: enPreparationIds.has(a.id) && !enLocationIds.has(a.id) }));

    // Un appareil "en location" (badge bleu, réservation confirmée dont la
    // période couvre aujourd'hui) doit afficher "Loué" en dessous — sinon le
    // menu déroulant reste sur "Disponible" jusqu'à ce que le transporteur
    // valide l'installation plus tard dans la journée, ce qui donnait
    // l'impression d'un statut manuel désynchronisé de la réalité. Ne touche
    // pas la localisation (l'appareil n'a pas forcément encore quitté le
    // dépôt) — seul le statut est aligné, journalisé comme tout changement.
    const aAligner = list.filter(a => a.en_location && a.statut !== 'loue');
    if (aAligner.length) {
      await Promise.all(aAligner.map(a => recordMouvement(supabase, {
        appareilId: a.id, typeEvenement: 'autre', nouveauStatut: 'loue',
        nouvelleLocalisation: a.localisation, utilisateur: 'systeme',
        commentaire: 'Statut aligné automatiquement sur "Loué" — réservation confirmée en cours.',
      })));
      aAligner.forEach(a => { a.statut = 'loue'; });
    }

    const actifs = list.filter(a => !['panne', 'maintenance', 'loue', 'nettoyage', 'vendu'].includes(a.statut)).length;

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
