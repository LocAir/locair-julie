const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity } = require('./_lib/city');
const { checkAdminToken } = require('./_lib/auth');
const { normalizeTel } = require('./_lib/reservations');

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
    const city = await resolveAdminCity(supabase, body);
    if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });

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
          .select('client_id, adresse, tel_secondaire, type_client, raison_sociale, siret, date_debut, statut')
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
      const { data: client } = await supabase.from('clients').select('id').eq('id', id).eq('city_id', city.id).maybeSingle();
      if (!client) return res.status(404).json({ error: 'Client introuvable' });

      const { data: resas } = await supabase.from('reservations').select('id').eq('client_id', id);
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
        .eq('id', id).eq('city_id', city.id).maybeSingle();
      if (!client) return res.status(404).json({ error: 'Client introuvable' });

      const { data: resas } = await supabase
        .from('reservations')
        .select('id, ref, adresse, etage, ascenseur, instructions_acces, tel_secondaire, type_client, raison_sociale, siret, date_debut, statut')
        .eq('client_id', id)
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
              accepted_at, client_notifie_at, arrivee_at, fait_at,
              demo_faite, demo_faite_at, vidange_confirmee, vidange_at,
              probleme_type, probleme_description, probleme_at, incident_id,
              photo_depart_path, photo_installation_path, photo_retour_path, photo_absence_path
            `)
            .in('reservation_id', resaIds)
            .in('statut', ['a_faire', 'acceptee', 'arrivee', 'probleme'])
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
          accepted_at: l.accepted_at, client_notifie_at: l.client_notifie_at, arrivee_at: l.arrivee_at, fait_at: l.fait_at,
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

    if (action === 'update') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { data: before } = await supabase.from('clients').select('id').eq('id', id).eq('city_id', city.id).maybeSingle();
      if (!before) return res.status(404).json({ error: 'Client introuvable' });

      const patch = {};
      if (body.acces_difficile != null) patch.acces_difficile = body.acces_difficile.slice(0, 1000);
      if (body.prenom != null) patch.prenom = body.prenom.trim().slice(0, 200) || 'Client';
      if (body.nom != null)    patch.nom    = body.nom.trim().slice(0, 200) || null;
      if (body.email != null)  patch.email  = body.email.trim().slice(0, 200) || null;
      // tel_normalise sert de clé de déduplication client (voir
      // _lib/reservations.js:findOrCreateClient) — sans recalcul ici, une future
      // réservation avec le nouveau numéro ne retrouverait plus ce client et en
      // créerait un doublon silencieux.
      if (body.tel != null) {
        patch.tel = body.tel.trim().slice(0, 50);
        patch.tel_normalise = normalizeTel(patch.tel);
      }
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Rien à modifier' });
      const { error } = await supabase.from('clients').update(patch).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin clients]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
