const { getSupabase } = require('./_lib/supabase');
const { checkAdminToken } = require('./_lib/auth');
const { sendBrevoSms } = require('./_lib/brevo');

// Contexte fictif partagé, mêmes valeurs bidon que admin-test-emails.js
// (Jean Testeur, dossier TEST-0001) — permet de comparer les deux outils
// de test facilement.
const REF = 'TEST-0001';
const PRENOM = 'Jean';
const DATE_LIVRAISON = 'lundi 20 juillet';
const CRENEAU = '14h–18h';
const DATE_RECUP = 'mardi 28 juillet';

// Un seul texte français par SMS (contrairement aux vrais envois qui
// s'adaptent à la langue du client) — suffisant pour vérifier que le canal
// Brevo fonctionne et relire le contenu exact, comme admin-test-emails.js.
const SMS = {
  confirmation: {
    libelle: 'Réservation confirmée',
    content: `[TEST] Loc'Air - Votre réservation est confirmée. Livraison prévue le ${DATE_LIVRAISON}, créneau ${CRENEAU} Notre technicien vous enverra un SMS 30 min avant son arrivée. Une question ? Appelez-nous au 06 63 79 87 56.`,
  },
  client_absent: {
    libelle: 'Client absent',
    content: `[TEST] Loc'Air - Notre technicien s'est présenté pour vous livrer votre climatiseur, mais personne n'a répondu. Merci de nous rappeler au 06 63 79 87 56 pour reprogrammer.`,
  },
  relance_prolongation: {
    libelle: 'Relance prolongation',
    content: `[TEST] Bonjour ${PRENOM},\n\nJ'espère que vous allez bien.\n\nPetite info : vous pouvez prolonger votre location en quelques clics, quelle que soit la durée !\n\nNuméro de commande : ${REF}\n\nhttps://www.locair.fr/prolongation\n\nBonne journée.\nAly de Loc'Air`,
  },
  rappel_recuperation: {
    libelle: 'Rappel récupération',
    content: `[TEST] Loc'Air - Votre location se termine aujourd'hui. Notre technicien viendra récupérer l'appareil demain (${DATE_RECUP}) et vous enverra un SMS 30 min avant son arrivée. Une question ? Appelez-nous au 06 63 79 87 56.`,
  },
  prolongation: {
    libelle: 'Prolongation confirmée',
    content: `[TEST] Loc'Air - Votre prolongation de 7 jours est confirmée. Récupération prévue le ${DATE_RECUP}, créneau ${CRENEAU}. Notre technicien vous enverra un SMS 30 min avant son arrivée. Une question ? Appelez-nous au 06 63 79 87 56.`,
  },
  recuperation_reprogrammee: {
    libelle: 'Récupération reprogrammée',
    content: `[TEST] Loc'Air - Suite à votre demande, nous vous confirmons que la récupération de votre climatiseur aura bien lieu le ${DATE_RECUP}, créneau ${CRENEAU}. Une question ? Appelez-nous au 06 63 79 87 56.`,
  },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const tel = (req.body?.tel || '').trim();
  if (!tel) return res.status(400).json({ error: 'Numéro de téléphone requis' });

  const sent = [];
  const errors = [];
  for (const def of Object.values(SMS)) {
    const result = await sendBrevoSms({ to: tel, content: def.content });
    if (result.ok) sent.push(def.libelle);
    else errors.push({ modele: def.libelle, error: result.error });
  }

  return res.status(200).json({ ok: true, envoyes: sent.length, sent, errors });
};
