const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity, listCities } = require('./_lib/city');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');
const { normalizeTel } = require('./_lib/reservations');
const { generateAndSendDocuments, generateAndSendFactureVente } = require('./_lib/documents');
const { notifyTransporteur } = require('./_lib/transporteurNotif');

// Fiche client persistante — déduplication par téléphone (voir
// _lib/reservations.js:findOrCreateClient). acces_difficile est une note
// libre qui enrichit la fiche pour la prochaine visite (digicode, étage sans
// ascenseur, parking impossible...) — jamais un blocage, juste une info
// consultée par l'admin et le livreur.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  // RBAC (audit 2026-08-06 C2) : checkAdminToken ne vérifie que la session,
  // pas le rôle — un compte sans accès "clients" pouvait lire/modifier toutes
  // les fiches client. Remplacé par checkAdminRole + roleHasAccess.
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });
  if (!roleHasAccess(admin.role, 'clients')) return res.status(403).json({ error: "Ton compte n'a pas accès aux fiches clients." });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    const city = await resolveAdminCity(supabase, body);
    if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });
    // resolveAdminCity() retombe sur la 1re ville active pour city_id:'all'
    // (aucune notion d'agrégat pour un id unique) — cityIds couvre ici
    // réellement toutes les villes actives dans ce mode, sinon les clients
    // des autres villes disparaissaient silencieusement de la liste alors
    // que le sélecteur affiche "Toutes les villes".
    const cityIds = body.city_id === 'all' ? (await listCities(supabase)).map(c => c.id) : [city.id];

    if (action === 'list') {
      const { data: clients, error } = await supabase
        .from('clients')
        .select('id, prenom, nom, tel, email, acces_difficile, created_at')
        .in('city_id', cityIds)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;

      const clientIds = (clients || []).map(c => c.id);
      const resasByClient = {};
      if (clientIds.length) {
        const { data: resas } = await supabase
          .from('reservations')
          .select('client_id, adresse, tel_secondaire, type_client, raison_sociale, siret, date_debut, statut')
          .in('client_id', clientIds)
          .in('city_id', cityIds)
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
          derniere_date_debut: resas[0]?.date_debut || null,
          tel_secondaire:   resas.find(r => r.tel_secondaire)?.tel_secondaire || null,
          raison_sociale:   resas.find(r => r.type_client === 'entreprise')?.raison_sociale || null,
          siret:            resas.find(r => r.type_client === 'entreprise')?.siret || null,
        };
      });
      return res.status(200).json({ clients: result });
    }

    // Historique des preuves photo prises chez ce client, tous appareils/missions
    // confondus dans le temps — la fiche client doit rester la mémoire durable
    // (litige, appareil en panne, contrôle) même une fois la mission archivée.
    if (action === 'photos') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { data: client } = await supabase.from('clients').select('id').eq('id', id).in('city_id', cityIds).maybeSingle();
      if (!client) return res.status(404).json({ error: 'Client introuvable' });

      const { data: resas } = await supabase.from('reservations').select('id').eq('client_id', id).in('city_id', cityIds);
      const resaIds = (resas || []).map(r => r.id);
      if (!resaIds.length) return res.status(200).json({ photos: [] });

      const { data: livs } = await supabase
        .from('livraisons')
        .select('id, type, date_prevue, photo_depart_path, photo_installation_path, photo_retour_path, photo_absence_path')
        .in('reservation_id', resaIds)
        .order('date_prevue', { ascending: false });

      const KINDS = [
        ['photo_depart',       'photo_depart_path'],
        ['photo_installation', 'photo_installation_path'],
        ['photo_retour',       'photo_retour_path'],
        ['photo_absence',      'photo_absence_path'],
      ];
      const photos = [];
      (livs || []).forEach(l => {
        KINDS.forEach(([kind, col]) => {
          if (l[col]) photos.push({ livraison_id: l.id, kind, type: l.type, date_prevue: l.date_prevue });
        });
      });
      return res.status(200).json({ photos });
    }

    // Fiche client détaillée : suivi en direct de la mission active (étape par
    // étape), photos au fur et à mesure, et incidents liés — sécurité/traçabilité
    // en cas de litige. L'admin reste un observateur passif (pas de bureau, le
    // transporteur est autonome) : cette vue ne fait qu'afficher, jamais agir.
    if (action === 'fiche') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { data: client } = await supabase
        .from('clients').select('id, prenom, nom, tel, email, acces_difficile, created_at')
        .eq('id', id).in('city_id', cityIds).maybeSingle();
      if (!client) return res.status(404).json({ error: 'Client introuvable' });

      const { data: resas } = await supabase
        .from('reservations')
        .select('id, ref, adresse, etage, ascenseur, instructions_acces, tel_secondaire, type_client, raison_sociale, siret, date_debut, statut')
        .eq('client_id', id).in('city_id', cityIds)
        .order('date_debut', { ascending: false });
      const resaIds = (resas || []).map(r => r.id);

      let missionsActives = [];
      let incidents = [];
      if (resaIds.length) {
        const [livsRes, incidentsRes] = await Promise.all([
          supabase
            .from('livraisons')
            .select(`
              id, type, statut, date_prevue, creneau, reservation_id,
              accepted_at, depart_at, client_notifie_at, arrivee_at, fait_at,
              demo_faite, demo_faite_at, vidange_confirmee, vidange_at,
              probleme_type, probleme_description, probleme_at, incident_id,
              photo_depart_path, photo_installation_path, photo_retour_path, photo_absence_path
            `)
            .in('reservation_id', resaIds)
            .in('statut', ['a_faire', 'acceptee', 'en_route', 'arrivee', 'probleme'])
            .order('date_prevue', { ascending: true }),
          supabase
            .from('incidents')
            .select('id, type, description, montant_facture_cents, statut, created_at, reservation_id')
            .in('reservation_id', resaIds)
            .order('created_at', { ascending: false }),
        ]);
        missionsActives = (livsRes.data || []).map(l => ({
          id: l.id, type: l.type, statut: l.statut, date_prevue: l.date_prevue, creneau: l.creneau,
          reservation_id: l.reservation_id,
          accepted_at: l.accepted_at, depart_at: l.depart_at, client_notifie_at: l.client_notifie_at, arrivee_at: l.arrivee_at, fait_at: l.fait_at,
          demo_faite: l.demo_faite, demo_faite_at: l.demo_faite_at,
          vidange_confirmee: l.vidange_confirmee, vidange_at: l.vidange_at,
          probleme_type: l.probleme_type, probleme_description: l.probleme_description, probleme_at: l.probleme_at,
          incident_id: l.incident_id,
          photo_depart_ok: Boolean(l.photo_depart_path),
          photo_installation_ok: Boolean(l.photo_installation_path),
          photo_retour_ok: Boolean(l.photo_retour_path),
          photo_absence_ok: Boolean(l.photo_absence_path),
        }));
        incidents = incidentsRes.data || [];
      }

      return res.status(200).json({ client, reservations: resas || [], missions_actives: missionsActives, incidents });
    }

    // Génération manuelle des documents d'une réservation, depuis la fiche
    // client (Module 9) — pour rattraper un cas où la génération automatique
    // post-paiement (webhook Stripe) n'a pas eu lieu ou pas abouti. Contourne
    // le verrou DOCUMENTS_ENABLED (voir _lib/documents.js) : ici c'est un
    // choix explicite de l'admin, pas un envoi silencieux automatique.
    // L'admin choisit indépendamment "contrat + facture de location" et
    // "facture d'achat" (Offre Privilège) — ce sont deux documents distincts,
    // le second n'existant que si le client a effectivement acheté son
    // climatiseur au lieu de le rendre.
    if (action === 'generer_documents') {
      const reservationId = parseInt(body.reservation_id);
      const wantLocation = Boolean(body.contrat_facture);
      const wantVente = Boolean(body.facture_vente);
      if (!reservationId || (!wantLocation && !wantVente)) {
        return res.status(400).json({ error: 'Paramètres invalides' });
      }
      const { data: resa } = await supabase.from('reservations').select('*').eq('id', reservationId).in('city_id', cityIds).maybeSingle();
      if (!resa) return res.status(404).json({ error: 'Réservation introuvable' });
      if (!['confirmee', 'terminee'].includes(resa.statut)) {
        return res.status(400).json({ error: `Impossible de générer les documents pour une réservation en statut "${resa.statut}"` });
      }

      const resultats = {};
      if (wantLocation) {
        const { data: existante } = await supabase
          .from('documents').select('id').eq('reservation_id', reservationId).eq('type', 'facture').maybeSingle();
        if (existante) {
          resultats.contrat_facture = 'deja_genere';
        } else {
          await generateAndSendDocuments(supabase, resa, { force: true });
          resultats.contrat_facture = 'genere';
        }
      }
      if (wantVente) {
        const { data: offre } = await supabase
          .from('offres_privilege').select('id, appareil_id, prix_vente_cents')
          .eq('reservation_id', reservationId).eq('statut', 'acceptee')
          .order('decidee_at', { ascending: false }).limit(1).maybeSingle();
        if (!offre) {
          resultats.facture_vente = 'aucune_offre';
        } else {
          const { data: existanteVente } = await supabase
            .from('documents').select('id').eq('reservation_id', reservationId).eq('type', 'facture_vente').maybeSingle();
          if (existanteVente) {
            resultats.facture_vente = 'deja_genere';
          } else {
            await generateAndSendFactureVente(supabase, {
              reservationId, appareilId: offre.appareil_id, prixCents: offre.prix_vente_cents, force: true,
            });
            resultats.facture_vente = 'genere';
          }
        }
      }
      return res.status(200).json({ ok: true, resultats });
    }

    if (action === 'update') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { data: before } = await supabase.from('clients').select('id').eq('id', id).in('city_id', cityIds).maybeSingle();
      if (!before) return res.status(404).json({ error: 'Client introuvable' });

      const patch = {};
      if (body.acces_difficile != null) patch.acces_difficile = body.acces_difficile.slice(0, 1000);
      if (body.prenom != null) patch.prenom = body.prenom.trim().slice(0, 200) || 'Client';
      if (body.nom != null)    patch.nom    = body.nom.trim().slice(0, 200) || null;
      // Minuscules, comme partout ailleurs (checkout.js, admin-reservations.js) —
      // même si clients.email ne sert pas de clé de recherche aujourd'hui,
      // mieux vaut rester cohérent plutôt que stocker une casse imprévisible.
      if (body.email != null)  patch.email  = body.email.trim().toLowerCase().slice(0, 200) || null;
      // tel_normalise sert de clé de déduplication client (voir
      // _lib/reservations.js:findOrCreateClient) — sans recalcul ici, une future
      // réservation avec le nouveau numéro ne retrouverait plus ce client et en
      // créerait un doublon silencieux.
      if (body.tel != null) {
        patch.tel = body.tel.trim().slice(0, 50);
        patch.tel_normalise = normalizeTel(patch.tel);
      }
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Rien à modifier' });
      const { error } = await supabase.from('clients').update(patch).eq('id', id).in('city_id', cityIds);
      if (error) throw error;

      // "Accès difficile" est justement l'info qui aide le transporteur à ne
      // pas se déplacer pour rien (digicode, chien, parking...) — une
      // correction ici doit remonter jusqu'à sa mission en cours chez ce
      // client, pas rester invisible jusqu'au prochain rafraîchissement.
      if (patch.acces_difficile !== undefined) {
        const { data: resasClient } = await supabase.from('reservations').select('id').eq('client_id', id);
        const resaIds = (resasClient || []).map(r => r.id);
        if (resaIds.length) {
          const { data: livAPrevenir } = await supabase
            .from('livraisons').select('id, transporteur_id')
            .in('reservation_id', resaIds)
            .in('statut', ['a_faire', 'acceptee', 'en_route', 'arrivee', 'probleme']);
          for (const liv of (livAPrevenir || [])) {
            if (!liv.transporteur_id) continue;
            await notifyTransporteur(supabase, liv.transporteur_id, {
              type: 'modification', message: 'Les informations d\'une mission ont été mises à jour.',
              livraisonId: liv.id, tag: 'modification',
            });
          }
        }
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin clients]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
