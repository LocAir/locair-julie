const { getSupabase } = require('./_lib/supabase');
const { checkAdminToken } = require('./_lib/auth');
const { sendBrevoEmail } = require('./_lib/brevo');
const { SCENARIOS, getSignature, withSignature } = require('./_lib/emailEngine');
const {
  tplProlongConfirmation, tplContratFacture, tplFactureVente,
  tplAmbassadeurCredentials, tplNouveauCodeAmbassadeur, tplNouveauCodeTransporteur,
} = require('./_lib/emailTemplates');

// Contexte fictif partagé par les 8 scénarios du moteur central — mêmes
// champs que buildEmailContext() dans _lib/emailEngine.js, avec des valeurs
// bidon clairement identifiables (Jean Testeur, dossier TEST-0001).
function fakeReservationCtx() {
  return {
    ref: 'TEST-0001',
    prenom: 'Jean',
    nom: 'Testeur',
    adresse: '12 rue de Test, 06000 Nice',
    creneau: '14h–18h',
    installation: 'Autonome',
    dateDebutFmt: 'lundi 20 juillet',
    dateFinFmt: 'lundi 27 juillet',
    montantFmt: '140,00 €',
    modeleClimatiseur: 'Climatiseur mobile Rowenta 10000 BTU',
    lienEspaceClient: 'https://www.locair.fr/#contact',
    lienTutoriel: 'https://www.locair.fr/#faq',
    lienProlongation: 'https://www.locair.fr/prolongation?ref=TEST-0001',
  };
}

// Chaque envoi ad hoc (hors des 8 scénarios) avec son sujet et son gabarit —
// mêmes libellés que dans les vrais points d'envoi (webhook.js,
// _lib/documents.js, admin-partenaires.js, *-forgot-pin.js).
const AD_HOC = {
  prolongation: {
    libelle: 'Confirmation de prolongation',
    subject: "✅ Prolongation confirmée — 7 jours ajoutés",
    html: () => tplProlongConfirmation({
      prenom: 'Jean', nom: 'Testeur', jours: '7',
      date_recuperation: 'lundi 27 juillet', creneau: '14h–18h', amount: '98,00 €',
    }),
  },
  contrat_facture: {
    libelle: 'Contrat + facture de location',
    subject: "📄 Votre contrat et votre facture Loc'Air — Dossier TEST-0001",
    html: () => tplContratFacture({
      prenom: 'Jean', ref: 'TEST-0001',
      viewUrlDocuments: 'https://www.locair.fr/#test',
    }),
  },
  facture_vente: {
    libelle: "Facture d'achat Offre Privilège",
    subject: "📄 Votre facture d'achat Loc'Air — Dossier TEST-0001",
    html: () => tplFactureVente({
      prenom: 'Jean', ref: 'TEST-0001',
      modeleClimatiseur: 'Klarstein WhiteWave 9K', dateAchatFmt: '17/07/2026', montantFmt: '399,00 €',
      viewUrlFacture: 'https://www.locair.fr/#test',
    }),
  },
  ambassadeur_credentials: {
    libelle: 'Espace ambassadeur (création / code changé)',
    subject: "🤝 Ton espace ambassadeur Loc'Air",
    html: () => tplAmbassadeurCredentials({ nom: 'Oke', lien: 'https://www.locair.fr/?p=test', pin: '123456' }),
  },
  nouveau_code_ambassadeur: {
    libelle: 'Code oublié — ambassadeur',
    subject: "🔐 Ton nouveau code ambassadeur Loc'Air",
    html: () => tplNouveauCodeAmbassadeur({ nom: 'Oke', lien: 'https://www.locair.fr/?p=test', pin: '654321' }),
  },
  nouveau_code_transporteur: {
    libelle: 'Code oublié — transporteur',
    subject: "🔐 Ton nouveau code Loc'Air",
    html: () => tplNouveauCodeTransporteur({ nom: 'Sophie', pin: '112233' }),
  },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'send_all';
  const email  = (body.email || '').trim();
  if (!email) return res.status(400).json({ error: 'Adresse email requise' });

  try {
    const sig = await getSignature(supabase);
    const ctx = fakeReservationCtx();
    const sent = [];
    const errors = [];

    // Les 8 scénarios du moteur central — même gabarit, même signature, que
    // ce que reçoit vraiment un client à chaque étape de sa location.
    for (const [key, def] of Object.entries(SCENARIOS)) {
      try {
        const html = withSignature(def.template(ctx), sig);
        await sendBrevoEmail({ to: email, subject: `[TEST] ${def.subject(ctx)}`, html, senderName: sig.nom_expediteur });
        sent.push(def.libelle);
      } catch (e) {
        errors.push({ modele: def.libelle, error: e.message });
      }
    }

    // Les envois ponctuels hors moteur (prolongation, documents, ambassadeur,
    // codes oubliés) — même contenu que ce qui part réellement.
    for (const def of Object.values(AD_HOC)) {
      try {
        const html = withSignature(def.html(), sig);
        await sendBrevoEmail({ to: email, subject: `[TEST] ${def.subject}`, html, senderName: sig.nom_expediteur });
        sent.push(def.libelle);
      } catch (e) {
        errors.push({ modele: def.libelle, error: e.message });
      }
    }

    return res.status(200).json({ ok: true, envoyes: sent.length, sent, errors });
  } catch (err) {
    console.error('[Admin test emails]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
