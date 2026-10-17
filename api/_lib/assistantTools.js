// Assistant IA de l'admin (demande d'Aly, 2026-08-20) — "une interface IA qui
// a la main sur tout, peut modifier n'importe quoi, peut ajouter n'importe
// quoi". Choix explicite d'Aly (question posée avant de coder) : l'IA
// n'utilise QUE les actions déjà existantes et déjà sécurisées de l'admin
// (pas d'accès direct à la base), et toute action qui modifie quelque chose
// doit d'abord lui être présentée pour confirmation avant de s'exécuter — les
// simples consultations, elles, s'exécutent tout de suite.
//
// Comment ça marche, techniquement : chaque outil ci-dessous correspond à une
// action déjà existante d'un fichier admin-xxx.js (celle que le bouton
// correspondant de l'admin appelle déjà). Un outil de LECTURE (mutating:false)
// est exécuté ici même, en appelant directement la fonction du handler
// (aucun appel réseau, aucune duplication de logique métier) avec le VRAI
// jeton admin — donc avec exactement les mêmes vérifications de rôle
// (roleHasAccess) qu'un humain qui cliquerait le même bouton. Un outil
// d'ÉCRITURE (mutating:true) n'est jamais exécuté ici : admin-assistant.js
// s'arrête avant et renvoie au front-end de quoi afficher une carte de
// confirmation (endpoint + action + paramètres) — c'est le navigateur de
// l'admin, une fois "Confirmer" cliqué, qui appelle réellement l'action, en
// repassant par le circuit normal (voir admin/index.html, assistantConfirm()).
const { getSupabase } = require('./supabase');

// Appelle un handler admin-xxx.js EN PROCESSUS, comme s'il recevait une vraie
// requête HTTP — même authentification (token), mêmes vérifications de rôle,
// mêmes règles métier que si l'admin avait cliqué le bouton correspondant.
// Aucun appel réseau : juste une invocation de fonction avec un req/res
// minimal qui capture le résultat au lieu de l'envoyer sur le réseau.
async function invokeAction(handlerModule, token, action, params) {
  const captured = { status: 200, data: null };
  const res = {
    status(code) { captured.status = code; return this; },
    json(data)   { captured.data = data; return this; },
  };
  const req = { method: 'POST', body: { ...params, action, token }, headers: {} };
  await handlerModule(req, res);
  return captured;
}

// Réduit une liste de réservations à ce qui est utile de montrer à l'IA (et
// filtre par recherche texte) — la vraie action 'list' renvoie jusqu'à 200
// réservations avec des dizaines de champs chacune, bien trop pour tenir
// raisonnablement dans le contexte d'une conversation.
function filtrerReservations(reservations, { recherche, statut, limite = 15 }) {
  let items = reservations || [];
  if (statut) items = items.filter(r => r.statut === statut || r.statut_commande === statut);
  if (recherche) {
    const q = recherche.toLowerCase();
    items = items.filter(r =>
      [r.ref, r.nom, r.prenom, r.tel, r.email, r.adresse].some(v => String(v || '').toLowerCase().includes(q)));
  }
  return items.slice(0, limite).map(r => ({
    id: r.id, ref: r.ref, client: `${r.prenom || ''} ${r.nom || ''}`.trim(), tel: r.tel, email: r.email,
    statut: r.statut, statut_commande: r.statut_commande, date_debut: r.date_debut, date_fin: r.date_fin,
    adresse: r.adresse, montant_euros: (r.prix_total_cents || 0) / 100, quantite: r.quantite,
    type_client: r.type_client, raison_sociale: r.raison_sociale || undefined,
  }));
}

function filtrerClients(clients, { recherche, limite = 15 }) {
  let items = clients || [];
  if (recherche) {
    const q = recherche.toLowerCase();
    items = items.filter(c => [c.nom, c.prenom, c.tel, c.email].some(v => String(v || '').toLowerCase().includes(q)));
  }
  return items.slice(0, limite).map(c => ({
    id: c.id, nom: `${c.prenom || ''} ${c.nom || ''}`.trim(), tel: c.tel, email: c.email,
    nb_reservations: c.nb_reservations, derniere_adresse: c.derniere_adresse,
  }));
}

const TOOL_SPECS = {

  // ── LECTURE (exécutées tout de suite, jamais de confirmation) ──────────
  dashboard_stats: {
    mutating: false,
    description: "Chiffres clés de l'activité (CA, réservations, panier moyen, occupation, incidents ouverts) sur une période.",
    input_schema: { type: 'object', properties: {
      periode: { type: 'string', enum: ['jour', '7j', '30j', 'mois'], description: "Période à consulter, défaut '7j'." },
    } },
    async run(admin, token, input) {
      const r = await invokeAction(require('../admin-dashboard'), token, undefined, { periode: input.periode || '7j' });
      return r.data;
    },
  },

  chercher_reservations: {
    mutating: false,
    description: 'Cherche des réservations par nom/téléphone/email/référence, ou filtre par statut. Renvoie au maximum 15 résultats.',
    input_schema: { type: 'object', properties: {
      recherche: { type: 'string', description: 'Texte à chercher (nom, tél, email, référence dossier).' },
      statut: { type: 'string', description: "Filtrer par statut exact (ex. 'confirmee', 'annulee', 'remboursee', 'en_attente')." },
    } },
    async run(admin, token, input) {
      const r = await invokeAction(require('../admin-reservations'), token, 'list', {});
      if (r.status !== 200) return r.data;
      return { reservations: filtrerReservations(r.data.reservations, input) };
    },
  },

  chercher_clients: {
    mutating: false,
    description: 'Cherche des clients par nom/téléphone/email. Renvoie au maximum 15 résultats.',
    input_schema: { type: 'object', properties: {
      recherche: { type: 'string', description: 'Texte à chercher (nom, tél, email).' },
    }, required: ['recherche'] },
    async run(admin, token, input) {
      const r = await invokeAction(require('../admin-clients'), token, 'list', {});
      if (r.status !== 200) return r.data;
      return { clients: filtrerClients(r.data.clients, input) };
    },
  },

  etat_du_parc: {
    mutating: false,
    description: "Tableau de bord du parc de climatiseurs : combien sont disponibles, en location, en préparation, en maintenance, hors service.",
    input_schema: { type: 'object', properties: {} },
    async run(admin, token) {
      const r = await invokeAction(require('../admin-stock'), token, 'dashboard', {});
      return r.data;
    },
  },

  chercher_appareil: {
    mutating: false,
    description: "Détail d'un climatiseur précis par son numéro (statut, localisation, dernier mouvement).",
    input_schema: { type: 'object', properties: {
      numero: { type: 'integer', description: 'Numéro imprimé sur l\'étiquette du climatiseur.' },
    }, required: ['numero'] },
    async run(admin, token, input) {
      const r = await invokeAction(require('../admin-stock'), token, 'scan_lookup', { numero: input.numero });
      return r.data;
    },
  },

  incidents_ouverts: {
    mutating: false,
    description: 'Liste des incidents (matériel endommagé, litige...) actuellement ouverts.',
    input_schema: { type: 'object', properties: {} },
    async run(admin, token) {
      const r = await invokeAction(require('../admin-incidents'), token, 'list', {});
      if (r.status !== 200) return r.data;
      const ouverts = (r.data.incidents || []).filter(i => ['nouveau', 'en_analyse', 'retard_a_facturer'].includes(i.statut));
      return { incidents: ouverts.slice(0, 20) };
    },
  },

  missions_du_jour: {
    mutating: false,
    description: "Livraisons/récupérations/missions prévues aujourd'hui, avec leur statut et le transporteur assigné.",
    input_schema: { type: 'object', properties: {} },
    async run(admin, token) {
      const r = await invokeAction(require('../admin-livraisons'), token, 'list', {});
      if (r.status !== 200) return r.data;
      const { todayParis } = require('./dates');
      const today = todayParis();
      const missions = (r.data.livraisons || []).filter(m => m.date_prevue === today && !['annule', 'refusee'].includes(m.statut));
      return { missions: missions.map(m => ({
        id: m.id, type: m.type, statut: m.statut, client: m.reservation ? `${m.reservation.prenom || ''} ${m.reservation.nom || ''}`.trim() : (m.titre || null),
        adresse: m.adresse_libre || m.reservation?.adresse, transporteur: m.transporteur?.nom || null, creneau: m.creneau,
      })) };
    },
  },

  virements_a_verser: {
    mutating: false,
    description: 'Total à verser aux transporteurs et aux ambassadeurs, détaillé par personne.',
    input_schema: { type: 'object', properties: {} },
    async run(admin, token) {
      const r = await invokeAction(require('../admin-virements'), token, 'summary', {});
      return r.data;
    },
  },

  board_emails_sms: {
    mutating: false,
    description: 'État de tous les emails/SMS automatiques du système : actifs ou non, volume et erreurs des 30 derniers jours.',
    input_schema: { type: 'object', properties: {} },
    async run(admin, token) {
      const r = await invokeAction(require('../admin-emails'), token, 'board', {});
      return r.data;
    },
  },

  chercher_devis: {
    mutating: false,
    description: 'Liste les devis entreprises existants (les plus récents), avec recherche par société/nom/email — pour retrouver un devis déjà créé avant de l\'envoyer, par exemple.',
    input_schema: { type: 'object', properties: {
      recherche: { type: 'string', description: 'Texte à chercher (raison sociale, nom, email).' },
    } },
    async run(admin, token, input) {
      const r = await invokeAction(require('../admin-devis'), token, 'list', {});
      if (r.status !== 200) return r.data;
      let items = r.data.devis || [];
      if (input.recherche) {
        const q = input.recherche.toLowerCase();
        items = items.filter(d => [d.raison_sociale, d.nom, d.prenom, d.email].some(v => String(v || '').toLowerCase().includes(q)));
      }
      return { devis: items.slice(0, 15).map(d => ({
        id: d.id, raison_sociale: d.raison_sociale, client: `${d.prenom || ''} ${d.nom || ''}`.trim(), email: d.email,
        statut: d.statut, prix_euros: (d.prix_propose_cents || 0) / 100, quantite: d.quantite,
        date_debut: d.date_debut, date_fin: d.date_fin, created_at: d.created_at,
      })) };
    },
  },

  // Calcule un prix RÉEL (même barème/formule que checkout.js — tarif
  // dégressif chargé depuis pricing_config, pas une valeur en dur dans ce
  // fichier qui pourrait diverger de la grille réellement appliquée aux
  // clients) — à utiliser SYSTÉMATIQUEMENT avant de proposer un devis ou de
  // créer une réservation, plutôt que de calculer ou deviner un montant.
  // Climatiseur mobile uniquement (grille particuliers) : ne couvre pas le
  // PortaSplit (abonnement, modèle de prix différent), les forfaits à prix
  // fixe, ni les codes promo — pour ces cas, demander le prix à
  // l'administrateur plutôt que d'improviser.
  calculer_prix: {
    mutating: false,
    description: "Calcule le prix réel d'une location de climatiseur mobile (tarif dégressif selon la durée, + livraison + installation + express) — à utiliser avant tout devis ou toute réservation, ne jamais inventer un prix. Ne couvre pas le PortaSplit ni les forfaits/codes promo.",
    input_schema: { type: 'object', properties: {
      date_debut: { type: 'string', description: 'YYYY-MM-DD — avec date_fin, alternative à duree_jours.' },
      date_fin: { type: 'string', description: 'YYYY-MM-DD' },
      duree_jours: { type: 'integer', description: 'Nombre de jours de location, alternative à date_debut/date_fin.' },
      quantite: { type: 'integer', description: 'Nombre de climatiseurs (1 à 5), défaut 1.' },
      installation: { type: 'string', enum: ['autonome', 'technicien'], description: "'technicien' ajoute 80€ ; 'autonome' (défaut) est gratuit." },
      express: { type: 'boolean', description: 'Livraison express sous 2h le jour même (+60€).' },
      hors_zone: { type: 'boolean', description: "true si l'adresse du client est hors de la zone de livraison standard (120€ de livraison au lieu de 60€)." },
    } },
    async run(admin, token, input) {
      const { getPricingConfig, calcTieredPrice } = require('./pricing');
      const supabase = getSupabase();
      const pricing = await getPricingConfig(supabase);

      let duree = parseInt(input.duree_jours);
      if (!Number.isFinite(duree) || duree <= 0) {
        if (input.date_debut && input.date_fin) {
          const d1 = new Date(input.date_debut + 'T12:00:00Z');
          const d2 = new Date(input.date_fin + 'T12:00:00Z');
          duree = Math.round((d2 - d1) / 86400000);
        }
      }
      if (!Number.isFinite(duree) || duree <= 0) {
        return { error: 'Indique soit duree_jours, soit date_debut ET date_fin.' };
      }
      const dureeAjustee = Math.max(pricing.duree_min_jours, Math.min(90, duree));
      const quantite = Math.min(5, Math.max(1, parseInt(input.quantite) || 1));

      const baseCents = Math.round(calcTieredPrice(dureeAjustee, pricing) * quantite * 100);
      const installCents = String(input.installation || '').toLowerCase() === 'technicien' ? 80 * 100 : 0;
      const deliveryFeeCents = input.hors_zone ? 120 * 100 : 60 * 100;
      const expressCents = input.express ? 60 * 100 : 0;
      const totalCents = baseCents + installCents + deliveryFeeCents + expressCents;

      return {
        duree_jours: dureeAjustee,
        duree_ajustee: dureeAjustee !== duree ? `Durée demandée (${duree}j) ajustée au minimum de ${pricing.duree_min_jours} jours.` : undefined,
        quantite,
        detail: {
          location_euros: baseCents / 100,
          installation_euros: installCents / 100,
          livraison_euros: deliveryFeeCents / 100,
          express_euros: expressCents / 100,
        },
        total_euros: totalCents / 100,
        total_cents: totalCents,
      };
    },
  },

  // ── ÉCRITURE (jamais exécutées ici — confirmation obligatoire côté front) ─
  changer_statut_reservation: {
    mutating: true,
    endpoint: 'admin-reservations', action: 'update',
    description: "Change le statut d'une réservation (confirmer, annuler, marquer terminée...). N'utilise PAS ceci pour rembourser — utilise rembourser_reservation.",
    input_schema: { type: 'object', properties: {
      id: { type: 'integer', description: 'id interne de la réservation (obtenu via chercher_reservations).' },
      statut: { type: 'string', enum: ['confirmee', 'annulee', 'terminee', 'en_attente'], description: 'Nouveau statut.' },
    }, required: ['id', 'statut'] },
    label(input) { return `Changer le statut de la réservation #${input.id} en "${input.statut}"`; },
  },

  rembourser_reservation: {
    mutating: true,
    endpoint: 'admin-reservations', action: 'rembourser',
    description: "Rembourse (totalement ou partiellement) une réservation payée par carte via Stripe. Irréversible.",
    input_schema: { type: 'object', properties: {
      id: { type: 'integer', description: 'id interne de la réservation.' },
      raison: { type: 'string', description: 'Raison du remboursement (obligatoire).' },
      montant_cents: { type: 'integer', description: 'Montant en centimes ; si absent, remboursement total.' },
    }, required: ['id', 'raison'] },
    label(input) { return `Rembourser la réservation #${input.id}${input.montant_cents ? ` (${(input.montant_cents / 100).toFixed(2)} €)` : ' (montant total)'} — motif : ${input.raison}`; },
  },

  creer_mission_libre: {
    mutating: true,
    endpoint: 'admin-livraisons', action: 'create',
    description: "Crée une mission libre, sans réservation associée (ex. aller chercher du matériel chez un fournisseur). Pour une mission liée à une réservation, ne pas utiliser cet outil.",
    input_schema: { type: 'object', properties: {
      titre: { type: 'string', description: 'Titre de la mission.' },
      adresse_libre: { type: 'string' },
      date_prevue: { type: 'string', description: 'YYYY-MM-DD' },
      montant_du_cents: { type: 'integer', description: 'Tarif fixé pour cette mission, en centimes.' },
    }, required: ['titre', 'date_prevue'] },
    label(input) { return `Créer la mission libre "${input.titre}" le ${input.date_prevue}${input.montant_du_cents ? ` (${(input.montant_du_cents / 100).toFixed(2)} €)` : ''}`; },
  },

  changer_statut_appareil: {
    mutating: true,
    endpoint: 'admin-stock', action: 'update',
    description: "Change le statut d'un climatiseur (disponible, panne, maintenance, nettoyage...).",
    input_schema: { type: 'object', properties: {
      id: { type: 'integer', description: 'id interne de l\'appareil (obtenu via chercher_appareil).' },
      statut: { type: 'string', enum: ['disponible', 'panne', 'maintenance', 'loue', 'nettoyage'] },
      justification: { type: 'string' },
    }, required: ['id', 'statut'] },
    label(input) { return `Passer l'appareil #${input.id} au statut "${input.statut}"`; },
  },

  resoudre_incident: {
    mutating: true,
    endpoint: 'admin-incidents', action: 'update',
    description: "Change le statut d'un incident (par ex. le marquer résolu ou clos).",
    input_schema: { type: 'object', properties: {
      id: { type: 'integer', description: 'id de l\'incident (obtenu via incidents_ouverts).' },
      statut: { type: 'string', enum: ['nouveau', 'en_analyse', 'resolu', 'clos', 'retard_a_facturer'] },
    }, required: ['id', 'statut'] },
    label(input) { return `Marquer l'incident #${input.id} comme "${input.statut}"`; },
  },

  activer_desactiver_scenario_email: {
    mutating: true,
    endpoint: 'admin-emails', action: 'toggle_scenario',
    description: "Active ou désactive un scénario d'email/SMS automatique pour TOUS les clients (ex. couper les rappels J-1). Impact large — bien vérifier le nom du scénario avec board_emails_sms avant.",
    input_schema: { type: 'object', properties: {
      id: { type: 'string', description: "Identifiant technique du scénario (ex. 'rappel_j1'), obtenu via board_emails_sms." },
      actif: { type: 'boolean' },
    }, required: ['id', 'actif'] },
    label(input) { return `${input.actif ? 'Activer' : 'Désactiver'} le scénario "${input.id}" — pour tous les clients`; },
  },

  creer_prime_transporteur: {
    mutating: true,
    endpoint: 'admin-virements', action: 'creer_prime',
    description: 'Crée une prime exceptionnelle pour un transporteur, sur un mois donné, avec envoi automatique d\'un email de félicitations.',
    input_schema: { type: 'object', properties: {
      transporteur_id: { type: 'integer' },
      mois: { type: 'string', description: 'Format AAAA-MM.' },
      montant_cents: { type: 'integer' },
    }, required: ['transporteur_id', 'mois', 'montant_cents'] },
    label(input) { return `Créer une prime de ${(input.montant_cents / 100).toFixed(2)} € pour le transporteur #${input.transporteur_id} (${input.mois})`; },
  },

  creer_devis: {
    mutating: true,
    endpoint: 'admin-devis', action: 'create',
    description: "Crée un devis entreprise (reste en brouillon, n'est PAS envoyé au client — utilise envoyer_devis ensuite). Utilise calculer_prix d'abord pour obtenir prix_propose_cents, sauf si l'administrateur donne lui-même un montant précis.",
    input_schema: { type: 'object', properties: {
      raison_sociale: { type: 'string', description: "Nom de l'entreprise cliente." },
      email: { type: 'string', description: 'Email du contact, pour l\'envoi du devis.' },
      prenom: { type: 'string' }, nom: { type: 'string' },
      siret: { type: 'string' }, tel: { type: 'string' },
      adresse: { type: 'string', description: 'Adresse de livraison.' },
      date_debut: { type: 'string', description: 'YYYY-MM-DD' }, date_fin: { type: 'string', description: 'YYYY-MM-DD' },
      quantite: { type: 'integer', description: "Nombre de climatiseurs." },
      installation: { type: 'string' },
      prix_propose_cents: { type: 'integer', description: 'Montant total proposé, en centimes — voir calculer_prix.' },
      notes: { type: 'string' },
    }, required: ['raison_sociale', 'email', 'prix_propose_cents'] },
    label(input) { return `Créer un devis pour "${input.raison_sociale}" — ${((input.prix_propose_cents || 0) / 100).toFixed(2)} €`; },
  },

  envoyer_devis: {
    mutating: true,
    endpoint: 'admin-devis', action: 'send',
    description: "Envoie par email au client un devis déjà créé (voir creer_devis ou chercher_devis pour obtenir son id).",
    input_schema: { type: 'object', properties: {
      id: { type: 'integer', description: 'id du devis à envoyer.' },
    }, required: ['id'] },
    label(input) { return `Envoyer le devis #${input.id} au client par email`; },
  },

  // Même action que le formulaire "Nouvelle réservation" de l'onglet
  // Réservations (admin-reservations.js, action 'create') — une réservation
  // prise au téléphone/par chat, pas une commande web. cgv_accepted n'est
  // JAMAIS supposé true par défaut : Claude doit le demander explicitement à
  // l'administrateur (voir system prompt), jamais le déduire silencieusement.
  creer_reservation: {
    mutating: true,
    endpoint: 'admin-reservations', action: 'create',
    description: "Crée une réservation prise par téléphone/chat (pas un paiement en ligne). Utilise calculer_prix d'abord pour obtenir prix_total_cents. Par défaut (confirmer non fourni ou true) la réservation est confirmée tout de suite et le contrat + la facture partent immédiatement au client — mets confirmer:false si le client doit encore payer lui-même (un lien de paiement lui est alors envoyé par SMS/email). Ne jamais appeler cet outil sans avoir confirmé avec l'administrateur que le client a bien accepté les CGV.",
    input_schema: { type: 'object', properties: {
      prenom: { type: 'string' }, nom: { type: 'string' },
      tel: { type: 'string', description: 'Obligatoire (format français ou international).' },
      email: { type: 'string' },
      adresse: { type: 'string', description: 'Adresse de livraison, obligatoire.' },
      type_client: { type: 'string', enum: ['particulier', 'entreprise'] },
      raison_sociale: { type: 'string' },
      date_debut: { type: 'string', description: 'YYYY-MM-DD' }, date_fin: { type: 'string', description: 'YYYY-MM-DD' },
      quantite: { type: 'integer' },
      installation: { type: 'string' },
      prix_total_cents: { type: 'integer', description: 'Montant total, en centimes — voir calculer_prix.' },
      cgv_accepted: { type: 'boolean', description: 'Le client a-t-il accepté les CGV ? À demander explicitement à l\'administrateur, jamais supposé.' },
      confirmer: { type: 'boolean', description: "true/absent = confirmée tout de suite (contrat+facture envoyés). false = en attente, lien de paiement envoyé au client." },
    }, required: ['tel', 'adresse', 'date_debut', 'date_fin', 'prix_total_cents', 'cgv_accepted'] },
    label(input) {
      const mode = input.confirmer === false ? 'en attente de paiement — un lien sera envoyé au client' : 'confirmée immédiatement — contrat et facture envoyés au client';
      const client = `${input.prenom || ''} ${input.nom || ''}`.trim() || input.tel;
      return `Créer la réservation de ${client} — ${((input.prix_total_cents || 0) / 100).toFixed(2)} € — ${mode}`;
    },
  },
};

// Format attendu par l'API Claude (Anthropic Messages API, tool use).
const TOOLS = Object.entries(TOOL_SPECS).map(([name, spec]) => ({
  name, description: spec.description, input_schema: spec.input_schema,
}));

module.exports = { TOOL_SPECS, TOOLS, invokeAction };
