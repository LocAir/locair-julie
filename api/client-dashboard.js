const { getSupabase } = require('./_lib/supabase');
const { verifyClientToken } = require('./_lib/auth');
const { computeClientProgress } = require('./_lib/clientProgress');
const { syncStatutDetaille } = require('./_lib/statutDetaille');
const { computeOrderStatus } = require('./_lib/orderStatus');
const { INCIDENT_OPEN_STATUSES } = require('./_lib/incidentStatus');
const { addDays, todayParis } = require('./_lib/dates');

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
  offre_privilege:     'Offre spéciale : gardez votre climatiseur',
};

function joursRestants(dateFin) {
  if (!dateFin) return null;
  const today = todayParis();
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

    // Une prolongation crée sa PROPRE ligne reservations (source=
    // site_prolongation, voir checkout-prolong.js/prolong-pay.js) — sa
    // mission de récupération, sa facture d'extension et son acceptation
    // CGV sont enregistrées sous CET id-là, jamais sous celui de la
    // réservation d'origine (reservationId ici, résolu par client-login.js).
    // Sans élargir ces requêtes à toute la "famille" de réservations, un
    // client qui a prolongé perdait purement et simplement sa mission de
    // récupération à venir (l'ancienne, sur l'origine, est annulée — la
    // nouvelle vit ailleurs) et ne voyait jamais la facture de son extension.
    const { data: prolongations } = await supabase
      .from('reservations').select('id, date_fin, statut').eq('reservation_origine_id', reservationId);
    const allResaIds = [reservationId, ...(prolongations || []).map(p => p.id)];
    // Vraie date de fin = la plus tardive entre : la fin d'origine, la fin
    // des prolongations payées déjà confirmées, et la date de récupération
    // (moins 1 jour) actuellement planifiée — cette dernière peut avoir été
    // repoussée par l'admin sans passer par une prolongation payante
    // (admin-livraisons.js action 'update', ex. le client garde l'appareil
    // quelques jours de plus). Après une prolongation le webhook met à jour
    // orig.date_fin, mais si ce write a silencieusement échoué la date
    // affichée serait fausse sans ce filet.
    let dateFinReelle = (prolongations || [])
      .filter(p => p.statut === 'confirmee' && p.date_fin)
      .reduce((max, p) => (!max || p.date_fin > max ? p.date_fin : max), resa.date_fin || null);

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
      { data: offresPrivilege },
    ] = await Promise.all([
      // 'refusee' exclu comme 'annule' : une mission refusée par un
      // transporteur sans réattribution reste dans cet état, et son ancienne
      // date/créneau ne doit pas s'afficher comme si elle tenait toujours —
      // computeOrderStatus (orderStatus.js) traite déjà les deux pareil pour
      // la barre de progression, ce filtre aligne l'affichage détaillé dessus.
      supabase.from('livraisons').select('type, statut, date_prevue, creneau, fait_at').in('reservation_id', allResaIds).not('statut', 'in', '(annulee,annule,refusee)').order('date_prevue', { ascending: true }),
      supabase.from('incidents').select('id').in('reservation_id', allResaIds).in('statut', INCIDENT_OPEN_STATUSES),
      supabase.from('reservation_appareils').select('appareil:appareils(numero, reference, modele:modeles_climatiseur(*))').eq('reservation_id', reservationId),
      supabase.from('documents').select('id, type, numero, statut, genere_at, access_token').in('reservation_id', allResaIds),
      supabase.from('cgv_acceptations').select('type, version, accepted_at').in('reservation_id', allResaIds),
      supabase.from('email_log').select('scenario, created_at').in('reservation_id', allResaIds).eq('statut', 'envoye').order('created_at', { ascending: false }),
      supabase.from('centre_aide_articles').select('slug, categorie, titre, contenu').eq('actif', true).order('ordre'),
      supabase.from('assistance_config').select('telephone, email, horaires, whatsapp_url, urgence').eq('id', 1).maybeSingle(),
      // Offre Privilège (Step 2) : ne remonte au client que si l'admin a
      // fixé un prix ("proposee") — tant que l'offre reste "eligible", elle
      // n'existe que côté admin. Une réservation à plusieurs climatiseurs
      // peut avoir plusieurs offres en même temps (une par appareil) — le
      // client choisit lui-même lesquelles accepter, indépendamment.
      // Utilise allResaIds (origine + prolongations) et non reservationId
      // seul : l'admin peut avoir créé l'offre sur l'ID d'une prolongation,
      // ce qui la rendait invisible si on ne cherchait que sur l'origine.
      supabase.from('offres_privilege').select('id, prix_vente_cents, appareil:appareils(numero)').in('reservation_id', allResaIds).eq('statut', 'proposee'),
    ]);

    const progress = computeClientProgress(resa, livraisons || [], (incidentsOuverts || []).length > 0);
    // `internal` ne doit jamais quitter le serveur (statut technique).
    if (progress) delete progress.internal;
    // Affichage détaillé (Module 7) recalculé sans l'incident (voir
    // statutDetaille.js) — un incident en cours reste visible par ailleurs,
    // sans effacer où en est réellement la commande.
    await syncStatutDetaille(supabase, reservationId, computeOrderStatus(resa, livraisons || [], false));

    const livraison    = (livraisons || []).find(l => l.type === 'livraison');
    const recuperation = (livraisons || []).find(l => l.type === 'recuperation');
    // Missions de changement (échange d'appareil) — audit 2026-08-06 I9 :
    // absentes de la réponse, le client ne voyait aucun rendez-vous de
    // remplacement dans son espace perso.
    const changements  = (livraisons || []).filter(l => l.type === 'changement' && !['annule','annulee','refusee'].includes(l.statut));
    const appareil = (reservAppareils || [])[0]?.appareil || null;

    // La récupération peut avoir été reprogrammée plus tard sans passer par
    // une prolongation payante (voir commentaire plus haut) — la date de
    // récupération (moins 1 jour) prime alors sur date_fin si elle est plus
    // tardive, pour que le client voie sa vraie date de fin d'utilisation.
    if (recuperation?.date_prevue) {
      const recupEnd = addDays(recuperation.date_prevue, -1);
      if (!dateFinReelle || recupEnd > dateFinReelle) dateFinReelle = recupEnd;
    }

    const notifications = (emailLog || [])
      .filter(e => NOTIFICATION_LABEL[e.scenario])
      .map(e => ({ label: NOTIFICATION_LABEL[e.scenario], date: e.created_at }));

    return res.status(200).json({
      client: {
        prenom: resa.prenom || '',
        ref: resa.ref,
        statut_paiement: resa.statut === 'en_attente' ? 'en_attente' : (resa.statut === 'remboursee' ? 'rembourse' : (['annulee'].includes(resa.statut) ? 'annule' : 'paye')),
        date_debut: resa.date_debut,
        date_fin: dateFinReelle,
        jours_restants: joursRestants(dateFinReelle),
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
        date_fin: dateFinReelle,
        quantite: resa.quantite,
        montant_ttc_cents: resa.prix_total_cents,
      },
      livraison: livraison ? {
        date_prevue: livraison.date_prevue,
        creneau: livraison.creneau || null,
        type_intervention: resa.installation || 'Autonome',
        statut: livraison.statut,
      } : null,
      recuperation: recuperation ? {
        date_prevue: recuperation.date_prevue,
        creneau: recuperation.creneau || null,
        statut: recuperation.statut,
        consignes: [
          "Laissez l'accès disponible (digicode, gardien prévenu si besoin)",
          'Éteignez le climatiseur avant le passage du technicien',
          'Conservez les accessoires (télécommande, kit de calfeutrage)',
        ],
      } : null,
      changements: changements.map(c => ({
        date_prevue: c.date_prevue,
        creneau: c.creneau || null,
        statut: c.statut,
      })),
      mon_climatiseur: appareil?.modele ? {
        modele: appareil.modele.modele,
        marque: appareil.modele.marque,
        // Déjà lu et renvoyé plus haut dans ma_location.climatiseur — repris
        // ici pour afficher une photo dans la fiche technique (réassurance
        // visuelle façon détail de réservation Airbnb), aucune colonne
        // supplémentaire nécessaire.
        photo_url: appareil.modele.photo_url || null,
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
      offres_privilege: (offresPrivilege || []).map(o => ({ id: o.id, prix_cents: o.prix_vente_cents, appareil_numero: o.appareil?.numero ?? null })),
    });
  } catch (err) {
    console.error('[client-dashboard]', err.message);
    return res.status(500).json({ error: GENERIC_ERROR });
  }
};
