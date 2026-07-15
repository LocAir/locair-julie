const { getSupabase } = require('./_lib/supabase');
const { verifyClientToken } = require('./_lib/auth');
const { computeClientProgress } = require('./_lib/clientProgress');
const { INCIDENT_OPEN_STATUSES } = require('./_lib/incidentStatus');

const GENERIC_ERROR = "Nous n'avons pas retrouvé votre réservation. Merci de vérifier votre numéro de commande et votre adresse email.";

// Notifications client — dérivées EXCLUSIVEMENT du moteur central d'emails
// (email_log, voir _lib/emailEngine.js), jamais d'une logique séparée. Seuls
// les scénarios ayant un sens pour le client sont réétiquetés ici ; le
// libellé interne du scénario n'est jamais renvoyé tel quel.
const NOTIFICATION_LABEL = {
  confirmation:        'Réservation confirmée et paiement reçu',
  rappel_j1:           'Livraison programmée demain',
  post_installation:   'Installation terminée',
  rappel_recuperation: 'Récupération programmée demain',
  fin_location:        'Location terminée',
};

function joursRestants(dateFin) {
  if (!dateFin) return null;
  const today = new Date().toISOString().slice(0, 10);
  const diff = Math.round((new Date(dateFin + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000);
  return Math.max(0, diff);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();

  const reservationId = await verifyClientToken(req, supabase);
  if (!reservationId) return res.status(401).json({ error: GENERIC_ERROR });

  try {
    const { data: resa, error } = await supabase.from('reservations').select('*').eq('id', reservationId).maybeSingle();
    if (error) throw error;
    if (!resa) return res.status(404).json({ error: GENERIC_ERROR });

    // Tout le reste en parallèle — une seule requête HTTP côté client pour
    // construire l'ensemble du tableau de bord (voir contrainte de
    // performance du Module 4 : limiter le nombre d'allers-retours).
    const [
      { data: livraisons },
      { data: incidentsOuverts },
      { data: reservAppareils },
      { data: documents },
      { data: acceptations },
      { data: emailLog },
      { data: aideArticles },
      { data: assistance },
    ] = await Promise.all([
      supabase.from('livraisons').select('type, statut, date_prevue, creneau, fait_at').eq('reservation_id', reservationId),
      supabase.from('incidents').select('id').eq('reservation_id', reservationId).in('statut', INCIDENT_OPEN_STATUSES),
      supabase.from('reservation_appareils').select('appareil:appareils(numero, reference, modele:modeles_climatiseur(*))').eq('reservation_id', reservationId),
      supabase.from('documents').select('id, type, numero, statut, genere_at, access_token').eq('reservation_id', reservationId),
      supabase.from('cgv_acceptations').select('type, version, accepted_at').eq('reservation_id', reservationId),
      supabase.from('email_log').select('scenario, created_at').eq('reservation_id', reservationId).eq('statut', 'envoye').order('created_at', { ascending: false }),
      supabase.from('centre_aide_articles').select('slug, categorie, titre, contenu').eq('actif', true).order('ordre'),
      supabase.from('assistance_config').select('*').eq('id', 1).maybeSingle(),
    ]);

    const progress = computeClientProgress(resa, livraisons || [], (incidentsOuverts || []).length > 0);
    // `internal` ne doit jamais quitter le serveur (statut technique).
    delete progress.internal;

    const livraison    = (livraisons || []).find(l => l.type === 'livraison');
    const recuperation = (livraisons || []).find(l => l.type === 'recuperation');
    const appareil = (reservAppareils || [])[0]?.appareil || null;

    const notifications = (emailLog || [])
      .filter(e => NOTIFICATION_LABEL[e.scenario])
      .map(e => ({ label: NOTIFICATION_LABEL[e.scenario], date: e.created_at }));

    return res.status(200).json({
      client: {
        prenom: resa.prenom || '',
        ref: resa.ref,
        statut_paiement: resa.statut === 'en_attente' ? 'en_attente' : (['annulee'].includes(resa.statut) ? 'annule' : 'paye'),
        date_debut: resa.date_debut,
        date_fin: resa.date_fin,
        jours_restants: joursRestants(resa.date_fin),
      },
      progress, // { stage, stageLabel, banner, nextStep }
      ma_location: {
        climatiseur: appareil ? {
          numero: appareil.numero,
          modele: appareil.modele?.modele || null,
          marque: appareil.modele?.marque || null,
          puissance_btu: appareil.modele?.puissance_btu || null,
          photo_url: appareil.modele?.photo_url || null,
        } : null,
        date_debut: resa.date_debut,
        date_fin: resa.date_fin,
        quantite: resa.quantite,
        montant_ttc_cents: resa.prix_total_cents,
      },
      livraison: livraison ? {
        date_prevue: livraison.date_prevue,
        creneau: livraison.creneau || null,
        type_intervention: resa.installation || 'Autonome',
      } : null,
      recuperation: recuperation ? {
        date_prevue: recuperation.date_prevue,
        creneau: recuperation.creneau || null,
        consignes: [
          "Laissez l'accès disponible (digicode, gardien prévenu si besoin)",
          'Éteignez le climatiseur avant le passage du technicien',
          'Conservez les accessoires (télécommande, kit de calfeutrage)',
        ],
      } : null,
      mon_climatiseur: appareil?.modele ? {
        modele: appareil.modele.modele,
        marque: appareil.modele.marque,
        puissance_btu: appareil.modele.puissance_btu,
        surface_max_m2: appareil.modele.surface_max_m2,
        niveau_sonore_db: appareil.modele.niveau_sonore_db,
        classe_energie: appareil.modele.classe_energie,
        conseils_utilisation: appareil.modele.conseils_utilisation,
        video_tutoriel_url: appareil.modele.video_tutoriel_url,
        documentation_url: appareil.modele.documentation_url,
      } : null,
      documents: (documents || []).map(d => ({
        type: d.type, numero: d.numero, statut: d.statut, genere_at: d.genere_at,
        // Le token d'accès sert de lien de consultation (jamais le storage_path) —
        // réutilise le même mécanisme que l'email (api/document-view.js).
        url: `/api/document-view?token=${d.access_token}`,
      })),
      cgv_acceptees: (acceptations || []).map(a => ({
        type: a.type, version: a.version, accepted_at: a.accepted_at,
        lien: a.type === 'conditions_utilisation' ? '/cgv#obligations' : '/cgv',
      })),
      notifications,
      centre_aide: aideArticles || [],
      assistance: assistance || null,
      lien_prolongation: `https://www.locair.fr/prolongation?ref=${encodeURIComponent(resa.ref)}`,
    });
  } catch (err) {
    console.error('[client-dashboard]', err.message);
    return res.status(500).json({ error: GENERIC_ERROR });
  }
};
