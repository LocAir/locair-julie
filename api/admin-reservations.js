const Stripe = require('stripe');
const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity, notifyIfSoldOut } = require('./_lib/city');
const { getAvailability } = require('./_lib/stock');
const { isValidDate, addDays, todayParis } = require('./_lib/dates');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');
const { confirmReservation, sendConfirmationCommunications, sendProlongationConfirmation } = require('./_lib/reservations');
const { fmtDate } = require('./_lib/emailEngine');
const { ACCEPTANCE_TYPES, CGV_VERSION } = require('./_lib/legal');
const { computeOrderStatus } = require('./_lib/orderStatus');
const { syncStatutDetaille } = require('./_lib/statutDetaille');
const { INCIDENT_OPEN_STATUSES } = require('./_lib/incidentStatus');
const { notifyTransporteur } = require('./_lib/transporteurNotif');
const { sendReservationPaymentLink } = require('./_lib/paymentLink');
const { generateAndSendDocumentsAfterProlongation } = require('./_lib/documents');
const { extractPostalCode } = require('./_lib/postal');
const { releaseAppareilFromReservation } = require('./_lib/appareilSync');
const { pushToAdmin } = require('./_lib/push');
const { toE164FR } = require('./_lib/brevo');

const RESA_LABEL_FR = { en_attente: 'en attente', confirmee: 'confirmée', annulee: 'annulée', terminee: 'terminée', remboursee: 'remboursée' };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    const city = await resolveAdminCity(supabase, body);
    if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });

    if (action === 'list') {
      const { data, error } = await supabase
        .from('reservations')
        .select('id, ref, prenom, nom, tel, tel_secondaire, email, adresse, etage, ascenseur, fenetre, fenetre_photo_path, installation, instructions_acces, creneau, date_debut, date_fin, quantite, prix_total_cents, statut, source, masquee, hors_zone, type_client, raison_sociale, siret, logement, parrain_code, partenaire_commission_cents, motifs, mkt_consent, created_at, partenaire:partenaires ( nom ), reservation_appareils ( appareil:appareils ( numero ) )')
        .eq('city_id', city.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      const reservations = data || [];

      // Statut "commande" (affichage uniquement) : combine reservations.statut
      // et l'état des missions livraison/récupération — voir _lib/orderStatus.js.
      // N'écrit rien, ne modifie aucun statut existant.
      const ids = reservations.map(r => r.id);
      let livraisonsByResa = new Map();
      let incidentResaIds = new Set();
      let appareilsEnAttenteResaIds = new Set();
      let dernierEnvoiByResa = new Map();
      if (ids.length) {
        // Uniquement les réservations où "Renvoyer le lien" peut apparaître
        // (voir admin/index.html) — pas la peine d'interroger email_log pour
        // le reste.
        const pendingManuelIds = reservations.filter(r => r.statut === 'en_attente' && r.source === 'manuel').map(r => r.id);
        const [{ data: livs }, { data: incs }, { data: ras }, { data: envois }] = await Promise.all([
          supabase.from('livraisons').select('reservation_id, type, statut, fait_at').in('reservation_id', ids),
          supabase.from('incidents').select('reservation_id').in('reservation_id', ids).in('statut', INCIDENT_OPEN_STATUSES),
          supabase.from('reservation_appareils').select('reservation_id, valide').in('reservation_id', ids),
          pendingManuelIds.length
            ? supabase.from('email_log').select('reservation_id, canal, statut, created_at')
                .in('reservation_id', pendingManuelIds).in('scenario', ['lien_paiement', 'relance_paiement'])
                .order('created_at', { ascending: false })
            : Promise.resolve({ data: [] }),
        ]);
        for (const l of (livs || [])) {
          if (!livraisonsByResa.has(l.reservation_id)) livraisonsByResa.set(l.reservation_id, []);
          livraisonsByResa.get(l.reservation_id).push(l);
        }
        incidentResaIds = new Set((incs || []).map(i => i.reservation_id));
        // Attribution appareil "en attente de validation" (Module 6, Partie 6) :
        // au moins un appareil pas encore validé par l'administration.
        appareilsEnAttenteResaIds = new Set((ras || []).filter(r => !r.valide).map(r => r.reservation_id));
        // Le plus récent en premier (order desc ci-dessus) — on ne garde que
        // le premier vu par réservation.
        for (const e of (envois || [])) {
          if (!dernierEnvoiByResa.has(e.reservation_id)) dernierEnvoiByResa.set(e.reservation_id, e);
        }
      }
      // L'incident n'est volontairement pas passé ici (voir statutDetaille.js) :
      // statut_detaille doit refléter où en est vraiment la commande, un
      // incident en cours restant visible par ailleurs (badge Problèmes).
      for (const r of reservations) {
        r.statut_commande = computeOrderStatus(r, livraisonsByResa.get(r.id) || [], incidentResaIds.has(r.id));
        r.appareils_en_attente_validation = appareilsEnAttenteResaIds.has(r.id);
        // Numéros d'appareil assignés — utilisé par la vue "par date" (quel
        // climatiseur part/revient tel jour), voir renderReservationsCalendrier().
        r.appareil_numeros = (r.reservation_appareils || [])
          .map(ra => ra.appareil?.numero).filter(n => n != null).sort((a, b) => a - b);
        delete r.reservation_appareils;
        const dernierEnvoi = dernierEnvoiByResa.get(r.id);
        r.dernier_envoi_lien = dernierEnvoi
          ? { canal: dernierEnvoi.canal, statut: dernierEnvoi.statut, quand: dernierEnvoi.created_at }
          : null;
      }
      Promise.all(reservations.map(r =>
        syncStatutDetaille(supabase, r.id, computeOrderStatus(r, livraisonsByResa.get(r.id) || [], false))
      )).catch(e => console.error('[syncStatutDetaille]', e.message));

      return res.status(200).json({ reservations });
    }

    // Réservation prise en direct par l'admin (téléphone, WhatsApp...). Créée
    // puis confirmée immédiatement : contrairement à un panier du site, il n'y a
    // pas de risque d'abandon puisque l'admin sait déjà que le client s'engage.
    if (action === 'create') {
      let prenom    = (body.prenom  || '').trim().slice(0, 200);
      const nom     = (body.nom     || '').trim().slice(0, 200);
      const tel     = toE164FR((body.tel     || '').trim()) || (body.tel     || '').trim().slice(0, 50);
      const telSecondaire = toE164FR((body.tel_secondaire || '').trim()) || (body.tel_secondaire || '').trim().slice(0, 50);
      const typeClient = body.type_client === 'entreprise' ? 'entreprise' : 'particulier';
      const raisonSociale = (body.raison_sociale || '').trim().slice(0, 300);
      const siret   = (body.siret   || '').trim().slice(0, 50);
      // Minuscules, comme checkout.js — cohérence avec toutes les recherches
      // par email (connexion espace client, prolongation).
      const email   = (body.email   || '').trim().toLowerCase().slice(0, 200);
      const adresse = (body.adresse || '').trim().slice(0, 500);
      // Détection hors zone comme checkout.js (site) : sans ça, une réservation
      // créée à la main restait toujours hors_zone=false par défaut, même pour
      // une adresse clairement hors du secteur couvert — le transporteur
      // touchait alors le tarif standard (30/40€) au lieu du tarif hors zone
      // (50/95€) pour une mission plus longue.
      const cpExplicite = (body.code_postal || '').trim();
      const cpAdresse = cpExplicite || extractPostalCode(adresse);
      const horsZone  = !(cpAdresse && Array.isArray(city.postal_codes) && city.postal_codes.includes(cpAdresse));
      const etage       = (body.etage       || '').trim().slice(0, 50);
      const ascenseur   = (body.ascenseur   || '').trim().slice(0, 50);
      const fenetre     = (body.fenetre     || '').trim().slice(0, 100);
      const installation = (body.installation || '').trim().slice(0, 100);
      const instructionsAcces = (body.instructions_acces || '').trim().slice(0, 1000);
      const creneau     = (body.creneau_livraison || '').trim().slice(0, 500);
      // Aucun champ obligatoire pour une réservation créée à la main (prise
      // au téléphone vite fait) — ce qui manque est complété avec des valeurs
      // par défaut sûres, à corriger plus tard depuis la fiche client. Les
      // dates restent structurellement nécessaires (elles pilotent le calcul
      // du stock disponible et la date des missions livraison/récupération),
      // donc jamais laissées vides : à défaut, aujourd'hui → +7 jours.
      let dateDebut = (body.date_debut || '').slice(0, 10);
      if (!isValidDate(dateDebut)) dateDebut = todayParis();
      let dateFin = (body.date_fin || '').slice(0, 10);
      if (!isValidDate(dateFin) || dateFin <= dateDebut) {
        const d = new Date(dateDebut + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() + 7);
        dateFin = d.toISOString().slice(0, 10);
      }
      const quantite   = Math.min(5, Math.max(1, parseInt(body.quantite) || 1));
      const prixTotalCents = Math.max(0, parseInt(body.prix_total_cents) || 0);
      const logement    = (body.logement     || '').trim().slice(0, 100);
      const parrainCode     = (body.parrain_code    || '').trim().slice(0, 50);
      const partenaireCode  = (body.partenaire_code || '').trim().toLowerCase().slice(0, 50);
      const motifs      = (body.motifs       || '').trim().slice(0, 300);
      const mktConsent  = Boolean(body.mkt_consent);

      let partenaireId = null;
      let partenaireCommissionCents = 0;
      if (partenaireCode) {
        const { data: partenaire } = await supabase
          .from('partenaires').select('id, taux_commission_pct').eq('code', partenaireCode).eq('actif', true).maybeSingle();
        if (partenaire) {
          partenaireId = partenaire.id;
          partenaireCommissionCents = Math.round(prixTotalCents * partenaire.taux_commission_pct / 100);
        }
      }
      // Même exigence que checkout.js côté site (case CGV/CGL cochée avant
      // paiement) — ici recueillie verbalement par l'admin au téléphone.
      // Sécurité en profondeur : l'UI bloque déjà l'envoi, mais l'API ne doit
      // jamais dépendre uniquement du JS client.
      if (body.cgv_accepted !== true) {
        return res.status(400).json({ error: "Le client doit accepter les CGV et les conditions d'utilisation avant de créer la réservation." });
      }
      // Une réservation prise par téléphone pour un client qui va payer
      // lui-même via un lien envoyé ensuite (ex. personne âgée pas à l'aise
      // avec le site) reste "en attente" — le circuit de confirmation normal
      // (webhook Stripe) s'en charge une fois le paiement fait. Par défaut
      // true pour ne pas changer le comportement des appelants existants.
      const confirmerImmediat = body.confirmer !== false;

      if (!prenom) prenom = 'Client';

      // Détection de doublon : même téléphone, dates qui se chevauchent, réservation
      // encore active (le doublon Maria Loftheim de ce soir venait exactement de là).
      // Contournable explicitement avec force=true une fois l'admin prévenu.
      const telNorm = tel.replace(/\D/g, '');
      if (telNorm && !body.force) {
        const { data: candidates } = await supabase
          .from('reservations')
          .select('ref, statut, tel, date_debut, date_fin')
          .eq('city_id', city.id)
          .in('statut', ['en_attente', 'confirmee'])
          .lt('date_debut', dateFin)
          .gt('date_fin', dateDebut);
        const dup = (candidates || []).find(c => c.tel && c.tel.replace(/\D/g, '') === telNorm);
        if (dup) {
          return res.status(409).json({
            duplicate: true,
            error: `Une réservation existe déjà pour ce téléphone sur des dates qui se chevauchent (${dup.ref}, ${RESA_LABEL_FR[dup.statut] || dup.statut}, ${dup.date_debut} → ${dup.date_fin}). Créer quand même ?`,
          });
        }
      }

      const _now = new Date();
      const ref = `LOC-${String(_now.getFullYear()).slice(2)}${String(_now.getMonth()+1).padStart(2,'0')}${String(_now.getDate()).padStart(2,'0')}-${crypto.randomInt(1000, 9999)}`;
      const { data: resa, error } = await supabase.from('reservations').insert({
        city_id: city.id, ref, prenom, nom, tel, tel_secondaire: telSecondaire || null,
        type_client: typeClient, raison_sociale: raisonSociale || null, siret: siret || null,
        email, adresse,
        etage: etage || null, ascenseur: ascenseur || null, fenetre: fenetre || null,
        installation: installation || null, instructions_acces: instructionsAcces || null,
        creneau: creneau || null,
        date_debut: dateDebut, date_fin: dateFin, quantite,
        prix_total_cents: prixTotalCents, statut: 'en_attente', source: 'manuel', hors_zone: horsZone,
        logement: logement || null, parrain_code: parrainCode || null,
        partenaire_id: partenaireId, partenaire_commission_cents: partenaireCommissionCents,
        motifs: motifs || null, mkt_consent: mktConsent,
        cgv_accepted_at: new Date().toISOString(),
      }).select().single();
      if (error) throw error;

      // Trace d'audit des trois acceptations, comme sur le site (checkout.js)
      // — même dossier légal qu'une commande web, jamais bloquant si l'écriture rate.
      try {
        await supabase.from('cgv_acceptations').insert([
          { reservation_id: resa.id, type: ACCEPTANCE_TYPES.CGV_LOCATION,           version: CGV_VERSION, accepted_at: resa.cgv_accepted_at },
          { reservation_id: resa.id, type: ACCEPTANCE_TYPES.CONDITIONS_UTILISATION, version: CGV_VERSION, accepted_at: resa.cgv_accepted_at },
          { reservation_id: resa.id, type: ACCEPTANCE_TYPES.AUTORISATION_RETARD,    version: CGV_VERSION, accepted_at: resa.cgv_accepted_at },
        ]);
      } catch (e) {
        console.error('[CGV acceptations manuel]', e.message);
      }

      if (!confirmerImmediat) {
        // Client pas présent pour payer tout de suite (pris au téléphone) :
        // préférence SMS (numéro de commande + lien Stripe) si le client a un
        // téléphone — sinon repli sur un email. Sans ni l'un ni l'autre, la
        // réservation est créée mais le client ne peut pas payer tout seul :
        // on le signale à l'admin plutôt que de laisser croire que tout est en ordre.
        let lienResult = { ok: false, error: 'Aucun téléphone ni email renseigné' };
        if (resa.tel || resa.email) {
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
          lienResult = await sendReservationPaymentLink(supabase, stripe, resa, { preferSms: true });
        }
        return res.status(200).json({
          ok: true, ref, en_attente: true,
          lien_envoye: lienResult.ok,
          lien_erreur: lienResult.ok ? null : lienResult.error,
          reservation: { ...resa, masquee: false },
        });
      }
      await confirmReservation(supabase, resa);
      // Une réservation prise au téléphone doit déclencher exactement les
      // mêmes communications client qu'un paiement en ligne (contrat+facture,
      // SMS de confirmation, email de confirmation) — jusqu'ici seul le
      // webhook Stripe s'en chargeait, laissant une réservation manuelle
      // sans aucune communication automatique.
      try {
        await sendConfirmationCommunications(supabase, resa);
      } catch (e) {
        console.error('[Communications confirmation]', e.message);
      }
      return res.status(200).json({ ok: true, ref, reservation: { ...resa, statut: 'confirmee', masquee: false } });
    }

    // Renvoi manuel du lien de paiement (email perdu, SMS pas parti, lien
    // expiré côté Stripe après 24h...) — recrée une session à chaque fois
    // plutôt que de réutiliser l'ancienne, jamais payée de toute façon, qui a
    // pu expirer. preferSms:true reproduit le même choix de canal qu'à la
    // création ('create'/'create_prolongation' ci-dessus) : SMS si un
    // téléphone est renseigné, email sinon — sans ça une réservation prise
    // par téléphone (SMS, souvent sans email) n'avait aucun moyen de
    // renvoi depuis la fiche.
    if (action === 'renvoyer_lien_paiement') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { data: resa } = await supabase.from('reservations').select('*').eq('id', id).eq('city_id', city.id).maybeSingle();
      if (!resa) return res.status(404).json({ error: 'Réservation introuvable' });
      if (resa.statut !== 'en_attente') return res.status(422).json({ error: "Cette réservation n'est plus en attente de paiement." });
      if (!resa.email && !resa.tel) return res.status(400).json({ error: 'Aucun email ni téléphone sur cette réservation — ajoutes-en un depuis "Modifier" avant de renvoyer le lien.' });
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const result = await sendReservationPaymentLink(supabase, stripe, resa, { preferSms: true });
      if (!result.ok) return res.status(502).json({ error: `Échec de l'envoi : ${result.error}` });
      return res.status(200).json({ ok: true, canal: resa.tel ? 'sms' : 'email' });
    }

    // Prolongation prise en direct par l'admin (téléphone) — même principe que
    // "create" ci-dessus mais pour /prolongation (api/prolong-lookup.js +
    // api/prolong-pay.js) : retrouver la réservation d'origine par email
    // (+ référence si besoin), pour afficher ses dates et permettre à l'admin
    // de saisir la nouvelle date de fin.
    if (action === 'lookup_prolongation') {
      const email = (body.email || '').trim().toLowerCase().slice(0, 200);
      const ref   = (body.ref   || '').trim().slice(0, 50);
      if (!email) return res.status(400).json({ error: 'Email requis' });

      let q = supabase
        .from('reservations')
        .select('id, ref, prenom, nom, tel, tel_secondaire, email, adresse, date_debut, date_fin, quantite, statut')
        .eq('city_id', city.id)
        .eq('email', email)
        .not('source', 'eq', 'site_prolongation')
        .in('statut', ['confirmee'])
        .order('created_at', { ascending: false })
        .limit(1);
      if (ref) q = q.ilike('ref', ref.toUpperCase());

      const { data: resa, error } = await q.maybeSingle();
      if (error) throw error;
      if (!resa) {
        return res.status(404).json({ error: `Aucune réservation active trouvée pour cet email${ref ? ' et cette référence' : ''}.` });
      }
      if (['annulee', 'remboursee'].includes(resa.statut)) {
        return res.status(422).json({ error: 'Cette réservation ne peut pas être prolongée.' });
      }
      const origDays = Math.round((new Date(resa.date_fin + 'T00:00:00Z') - new Date(resa.date_debut + 'T00:00:00Z')) / 86400000);
      return res.status(200).json({ ...resa, orig_days: origDays });
    }

    // Le device reste chez le client : contrairement à "create", pas de nouvel
    // appareil à livrer — la réservation créée transfère juste la même
    // logistique (adresse, téléphone) sur une nouvelle fenêtre de dates
    // (date_debut = ancienne date_fin), avec source 'site_prolongation' pour
    // que confirmReservation() sache n'assigner qu'une mission de
    // récupération (pas de livraison) et annuler l'ancienne récupération
    // devenue obsolète — exactement le circuit suivi par un paiement Stripe
    // fait depuis /prolongation.
    if (action === 'create_prolongation') {
      const origId       = parseInt(body.orig_id);
      const newDateFin    = (body.new_date_fin || '').slice(0, 10);
      const prixTotalCents = Math.max(0, parseInt(body.prix_total_cents) || 0);
      const confirmerImmediat = body.confirmer !== false;

      if (!origId || !isValidDate(newDateFin)) {
        return res.status(400).json({ error: 'Réservation d\'origine et nouvelle date requises' });
      }

      const { data: orig, error: origErr } = await supabase
        .from('reservations')
        .select('id, ref, prenom, nom, tel, tel_secondaire, email, adresse, date_debut, date_fin, quantite, statut, hors_zone, etage, ascenseur, fenetre, fenetre_photo_path, installation, instructions_acces, creneau, logement, type_client, raison_sociale, siret, stripe_payment_intent_id, lang, cgv_accepted_at, prix_total_cents, partenaire_id')
        .eq('id', origId).eq('city_id', city.id).maybeSingle();
      if (origErr) throw origErr;
      if (!orig) return res.status(404).json({ error: 'Réservation d\'origine introuvable' });
      if (orig.statut !== 'confirmee') {
        return res.status(422).json({ error: 'Seule une réservation confirmée peut être prolongée.' });
      }
      if (newDateFin <= orig.date_fin) {
        return res.status(400).json({ error: `La nouvelle date doit être postérieure au ${orig.date_fin}.` });
      }

      let partenaireCommissionCentsProlong = 0;
      if (orig.partenaire_id) {
        const { data: pt } = await supabase.from('partenaires')
          .select('taux_commission_pct').eq('id', orig.partenaire_id).maybeSingle();
        if (pt) partenaireCommissionCentsProlong = Math.round(prixTotalCents * pt.taux_commission_pct / 100);
      }

      const { data: existing } = await supabase.from('reservations').select('id').eq('reservation_origine_id', origId).in('statut', ['en_attente', 'confirmee']).maybeSingle();
      if (existing) return res.status(409).json({ error: 'Une prolongation est déjà en cours pour cette réservation.' });

      const _pnow = new Date();
      const ref = `LOC-${String(_pnow.getFullYear()).slice(2)}${String(_pnow.getMonth()+1).padStart(2,'0')}${String(_pnow.getDate()).padStart(2,'0')}-P${crypto.randomInt(1000, 9999)}`;
      const { data: resa, error } = await supabase.from('reservations').insert({
        city_id: city.id, ref,
        prenom: orig.prenom, nom: orig.nom, email: orig.email,
        tel: orig.tel, tel_secondaire: orig.tel_secondaire || null,
        adresse: orig.adresse,
        hors_zone: orig.hors_zone || false,
        // Champs d'accès copiés pour que le transporteur ait toutes les infos lors de la récupération
        etage:              orig.etage              || null,
        ascenseur:          orig.ascenseur          || null,
        fenetre:            orig.fenetre            || null,
        fenetre_photo_path: orig.fenetre_photo_path || null,
        installation:       orig.installation       || null,
        instructions_acces: orig.instructions_acces || null,
        creneau:            orig.creneau            || null,
        logement:           orig.logement           || null,
        date_debut: orig.date_fin, date_fin: newDateFin, quantite: orig.quantite || 1,
        prix_total_cents: prixTotalCents, statut: 'en_attente', source: 'site_prolongation',
        // Lien fiable vers la réservation prolongée — voir isSupersededReservation
        // (_lib/emailSchedule.js) et migration_reservation_origine.sql.
        reservation_origine_id: orig.id,
        // Commission partenaire : héritée du taux de la réservation d'origine.
        partenaire_id: orig.partenaire_id || null,
        partenaire_commission_cents: partenaireCommissionCentsProlong,
      }).select().single();
      if (error) throw error;

      if (!confirmerImmediat) {
        // Même envoi immédiat du lien de paiement que pour une nouvelle
        // réservation manuelle (voir action 'create' ci-dessus) — jusqu'ici
        // une prolongation prise par téléphone restait "en attente" sans
        // aucun lien envoyé, obligeant Aly à la confirmer manuellement dès
        // réception du paiement (voir renvoyer_lien_paiement, resté le seul
        // rattrapage possible).
        let lienResult = { ok: false, error: 'Aucun téléphone ni email renseigné' };
        if (resa.tel || resa.email) {
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
          lienResult = await sendReservationPaymentLink(supabase, stripe, resa, { preferSms: true });
        }
        return res.status(200).json({
          ok: true, ref, en_attente: true,
          lien_envoye: lienResult.ok,
          lien_erreur: lienResult.ok ? null : lienResult.error,
          reservation: { ...resa, masquee: false },
        });
      }
      await confirmReservation(supabase, resa);
      // Mettre à jour date_fin de la réservation d'origine pour que l'espace client
      // et les prolongations suivantes voient toujours la date réelle de fin.
      // Filet de sécurité en lecture (getEffectiveDateFin, _lib/reservations.js)
      // en cas d'échec — mais si Aly regarde directement la fiche réservation,
      // elle y verrait une date figée sans jamais savoir que cette écriture a
      // raté (audit automatisations, 2026-08-02) : alerte explicite ici.
      await supabase.from('reservations').update({ date_fin: newDateFin }).eq('id', origId)
        .then(() => {}, async e => {
          console.error('[Admin prolong] date_fin update:', e.message);
          await pushToAdmin(supabase, {
            title: '⚠️ Mise à jour de la date de fin échouée',
            body:  `Dossier ${orig.ref || '?'} : la nouvelle date de fin (${newDateFin}) n'a pas pu être enregistrée sur la réservation d'origine — vérifie/corrige manuellement.`,
            tag:   `prolong-datefin-echec-${origId}`,
          }).catch(() => {});
        });
      // Contrat mis à jour (nouvelle date de fin) + facture de l'extension —
      // même correctif que pour une prolongation payée en ligne (voir
      // webhook.js), sans quoi une prolongation prise par téléphone laissait
      // elle aussi le client avec un contrat figé sur l'ancienne durée.
      try {
        await generateAndSendDocumentsAfterProlongation(supabase, {
          origineResa: { ...orig, date_fin: newDateFin },
          prolongationResa: resa,
        });
      } catch (e) {
        console.error('[Admin prolong] documents mis à jour:', e.message);
      }
      // Même principe qu'une location standard (voir "create" ci-dessus) :
      // une prolongation prise par téléphone envoie le même email dédié
      // qu'une prolongation payée en ligne via /prolongation.
      try {
        // resa.date_debut = orig.date_fin, resa.date_fin = newDateFin (voir
        // insert ci-dessus) : la différence donne directement le nombre de
        // jours ajoutés par cette prolongation.
        const joursSupplementaires = Math.round((new Date(resa.date_fin + 'T00:00:00Z') - new Date(resa.date_debut + 'T00:00:00Z')) / 86400000);
        await sendProlongationConfirmation(supabase, {
          reservationId:    resa.id,
          email:            resa.email,
          tel:              resa.tel,
          prenom:           resa.prenom,
          nom:              resa.nom,
          jours:            joursSupplementaires,
          dateRecuperation: fmtDate(addDays(resa.date_fin, 1), resa.lang || 'fr'),
          creneau:          resa.creneau,
          amount:           ((resa.prix_total_cents || 0) / 100).toFixed(2) + ' €',
          lang:             resa.lang || 'fr',
          refOrigine:       orig.ref,
        });
      } catch (e) {
        console.error('[Communications prolongation]', e.message);
      }
      return res.status(200).json({ ok: true, ref, reservation: { ...resa, statut: 'confirmee', masquee: false } });
    }

    if (action === 'update') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });

      const { data: before } = await supabase.from('reservations').select('*').eq('id', id).eq('city_id', city.id).maybeSingle();
      if (!before) return res.status(404).json({ error: 'Réservation introuvable' });

      // Confirmer manuellement (ex. réservation prise par téléphone) doit passer
      // par le même circuit que le webhook Stripe : assignation d'un appareil
      // numéroté + création des missions terrain. Un simple patch du statut
      // laisserait la réservation "confirmée" sans aucune mission derrière.
      if (body.statut === 'confirmee') {
        if (before.statut === 'confirmee') {
          return res.status(422).json({ error: 'Cette réservation est déjà confirmée.' });
        }
        await confirmReservation(supabase, before);
        // Même communications qu'une confirmation à la création (voir action
        // "create" ci-dessus) — cette confirmation manuelle (ex. réservation
        // laissée "en attente" à la création, confirmée plus tard) doit
        // envoyer les mêmes emails/SMS/documents qu'un paiement en ligne.
        try {
          if (before.source === 'site_prolongation') {
            const joursSupplementaires = Math.round((new Date(before.date_fin + 'T00:00:00Z') - new Date(before.date_debut + 'T00:00:00Z')) / 86400000);
            // Retrouvée une seule fois, réutilisée pour l'email de confirmation
            // (dossier à afficher — jamais l'identifiant technique interne de
            // cette prolongation, voir emailTemplates.js) ET pour la mise à
            // jour de date_fin ci-dessous.
            let origLookup = supabase.from('reservations').select('*').eq('city_id', city.id).not('source', 'eq', 'site_prolongation');
            origLookup = before.reservation_origine_id
              ? origLookup.eq('id', before.reservation_origine_id)
              : origLookup.eq('date_fin', before.date_debut).ilike('email', (before.email || '').trim()).order('created_at', { ascending: false }).limit(1);
            const { data: origResa } = await origLookup.maybeSingle();

            await sendProlongationConfirmation(supabase, {
              reservationId:    before.id,
              email:            before.email,
              tel:              before.tel,
              prenom:           before.prenom,
              nom:              before.nom,
              jours:            joursSupplementaires,
              dateRecuperation: fmtDate(addDays(before.date_fin, 1), before.lang || 'fr'),
              creneau:          before.creneau,
              amount:           ((before.prix_total_cents || 0) / 100).toFixed(2) + ' €',
              lang:             before.lang || 'fr',
              refOrigine:       origResa?.ref,
            });

            // Mettre à jour date_fin de la réservation d'origine + régénérer son
            // contrat (nouvelle date de fin) et facturer l'extension — ce chemin
            // (confirmation manuelle d'une prolongation laissée "en attente")
            // ne le faisait jusqu'ici jamais, contrairement aux 2 autres chemins
            // de prolongation (webhook.js, action 'create_prolongation'
            // ci-dessus) — voir audit du 2026-07-27.
            try {
              if (origResa) {
                await supabase.from('reservations').update({ date_fin: before.date_fin }).eq('id', origResa.id);
                await generateAndSendDocumentsAfterProlongation(supabase, {
                  origineResa: { ...origResa, date_fin: before.date_fin },
                  prolongationResa: before,
                });
              }
            } catch (e) {
              console.error('[Admin update] documents prolongation mis à jour:', e.message);
            }
          } else {
            await sendConfirmationCommunications(supabase, before);
          }
        } catch (e) {
          console.error('[Communications confirmation]', e.message);
        }
        return res.status(200).json({ ok: true });
      }

      const STATUTS_VALIDES = ['en_attente', 'annulee', 'remboursee', 'terminee'];
      const patch = {};
      if (body.statut === 'en_attente' && ['terminee', 'remboursee', 'annulee'].includes(before.statut)) {
        return res.status(422).json({ error: `Impossible de réactiver une réservation ${before.statut}.` });
      }
      if (body.statut === 'remboursee' && !roleHasAccess(admin.role, 'finances')) {
        return res.status(403).json({ error: "Seul un compte finances peut marquer manuellement une réservation remboursée — utilise l'action de remboursement Stripe." });
      }
      if (body.statut != null && STATUTS_VALIDES.includes(body.statut)) patch.statut = body.statut;
      if (body.quantite != null) patch.quantite = Math.max(1, parseInt(body.quantite) || 1);
      if (body.prix_total_cents != null) patch.prix_total_cents = Math.max(0, parseInt(body.prix_total_cents) || 0);
      // "Masquer" retire juste la réservation de la liste affichée à l'admin (ex.
      // doublon créé par erreur) — ça ne touche ni le statut, ni le stock, ni les
      // missions, contrairement à "Annuler". Réversible via "Restaurer".
      if (body.masquee != null) patch.masquee = !!body.masquee;
      // Complète/corrige l'identité du client (ex. réservation créée avec le strict
      // minimum au téléphone, prénom/nom/adresse à ajouter après coup) — remonte
      // telle quelle aux missions terrain déjà créées (jointure reservation).
      if (body.prenom != null) patch.prenom = body.prenom.trim().slice(0, 200) || 'Client';
      if (body.nom != null)    patch.nom    = body.nom.trim().slice(0, 200);
      if (body.tel != null)    patch.tel    = toE164FR(body.tel.trim()) || body.tel.trim().slice(0, 50);
      if (body.adresse != null) {
        patch.adresse = body.adresse.trim().slice(0, 500);
        // Même détection hors zone qu'à la création (voir plus haut) —
        // recalculée ici pour qu'une adresse corrigée après coup (ex.
        // réservation créée avec le strict minimum au téléphone) mette bien
        // à jour hors_zone, plutôt que de la laisser figée sur sa valeur de
        // création.
        const cpAdresseMaj = extractPostalCode(patch.adresse);
        patch.hors_zone = !(cpAdresseMaj && Array.isArray(city.postal_codes) && city.postal_codes.includes(cpAdresseMaj));
      }
      // Complète/corrige les infos logistiques d'une réservation déjà créée (ex.
      // une réservation manuelle créée sans ces champs, ou une info donnée par
      // téléphone après coup) — ces infos remontent telles quelles à la mission
      // du transporteur, jamais un simple détail admin.
      if (body.etage != null)              patch.etage              = body.etage.trim().slice(0, 50) || null;
      if (body.ascenseur != null)          patch.ascenseur          = body.ascenseur.trim().slice(0, 50) || null;
      if (body.fenetre != null)            patch.fenetre            = body.fenetre.trim().slice(0, 100) || null;
      if (body.installation != null)       patch.installation       = body.installation.trim().slice(0, 100) || null;
      if (body.instructions_acces != null) patch.instructions_acces = body.instructions_acces.trim().slice(0, 1000) || null;
      if (body.creneau_livraison != null)  patch.creneau            = body.creneau_livraison.trim().slice(0, 500) || null;
      if (body.tel_secondaire != null)     patch.tel_secondaire     = toE164FR(body.tel_secondaire.trim()) || body.tel_secondaire.trim().slice(0, 50) || null;
      if (body.email != null)              patch.email              = body.email.trim().toLowerCase().slice(0, 200) || null;
      if (body.type_client != null)        patch.type_client        = body.type_client === 'entreprise' ? 'entreprise' : 'particulier';
      if (body.raison_sociale != null)     patch.raison_sociale     = body.raison_sociale.trim().slice(0, 300) || null;
      if (body.siret != null)              patch.siret              = body.siret.trim().slice(0, 50) || null;
      if (body.logement != null)           patch.logement           = body.logement.trim().slice(0, 100) || null;
      if (body.parrain_code != null)       patch.parrain_code       = body.parrain_code.trim().slice(0, 50) || null;
      if (body.motifs != null)             patch.motifs             = body.motifs.trim().slice(0, 300) || null;
      if (body.mkt_consent != null)        patch.mkt_consent        = !!body.mkt_consent;
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Rien à modifier' });
      const { error } = await supabase.from('reservations').update(patch).eq('id', id).eq('city_id', city.id);
      if (error) throw error;

      // Annuler OU rembourser une réservation doit aussi annuler ses missions
      // non terminées — sinon un transporteur peut encore voir/accomplir une
      // livraison pour une commande annulée/remboursée. Les missions déjà
      // "fait" restent intactes (travail réel déjà effectué, le transporteur
      // reste payé). Corrigé (audit automatisations, 2026-08-02) : jusqu'ici
      // seule 'annulee' déclenchait ce nettoyage — un remboursement manuel
      // laissait la mission active et l'appareil marqué occupé pour rien.
      // Une commission déjà versée à un partenaire pour cette réservation
      // devient un litige à réconcilier dès qu'elle est annulée/remboursée —
      // jusqu'ici visible seulement en badge (l'admin doit penser à ouvrir
      // l'onglet Partenaires), jamais poussé au moment où ça arrive
      // vraiment (audit automatisations, 2026-08-02).
      if ((patch.statut === 'annulee' || patch.statut === 'remboursee') && before.partenaire_commission_payee) {
        await pushToAdmin(supabase, {
          title: '⚠️ Litige commission partenaire',
          body:  `Dossier ${before.ref || '?'} ${patch.statut === 'remboursee' ? 'remboursé' : 'annulé'} — une commission a déjà été versée au partenaire, à réconcilier dans l'onglet Partenaires.`,
          tag:   `partenaire-litige-${id}`,
        });
      }

      if (patch.statut === 'annulee' || patch.statut === 'remboursee') {
        const { data: livMissions } = await supabase
          .from('livraisons').select('id, type, statut, transporteur_id')
          .eq('reservation_id', id)
          .in('statut', ['a_faire', 'acceptee', 'en_route', 'arrivee', 'probleme', 'fait']);
        // Si la livraison a déjà eu lieu (cas typique d'un remboursement en
        // cours de location, contrairement à une annulation qui survient
        // presque toujours avant livraison), le climatiseur est encore
        // physiquement chez le client : sa mission de récupération doit
        // avoir lieu normalement, jamais être annulée avec le reste.
        const livraisonDejaFaite = patch.statut === 'remboursee'
          && (livMissions || []).some(m => m.type === 'livraison' && m.statut === 'fait');
        const livAAnnuler = (livMissions || []).filter(m => m.statut !== 'fait' && !(livraisonDejaFaite && m.type === 'recuperation'));
        if (livAAnnuler.length) {
          // 'annule' (sans "e") : contrainte CHECK propre à livraisons.statut,
          // différente de reservations.statut ('annulee') — utiliser 'annulee'
          // ici violait systématiquement la contrainte, l'erreur passait
          // inaperçue (juste loguée plus bas) et la mission restait active,
          // laissant un transporteur livrer/récupérer pour une réservation
          // en réalité annulée.
          const { error: livError } = await supabase.from('livraisons').update({ statut: 'annule' })
            .in('id', livAAnnuler.map(l => l.id));
          if (livError) console.error('[annulation missions]', livError.message);
          const transpAPrevenir = new Set(livAAnnuler.filter(l => l.transporteur_id).map(l => l.transporteur_id));
          for (const tid of transpAPrevenir) {
            await notifyTransporteur(supabase, tid, {
              type: 'annulation', message: `Une mission a été annulée — la réservation a été ${patch.statut === 'remboursee' ? 'remboursée' : 'annulée'}.`, tag: 'annulation',
            });
          }
        }

        if (!livraisonDejaFaite) {
          // Libère les appareils engagés sur cette réservation — sans quoi un
          // appareil déjà lié (ex. statut aligné "loué" par l'onglet Stock dès
          // que la période couvre aujourd'hui, voir admin-stock.js) reste
          // invisible du stock disponible pour toujours après l'annulation.
          const { data: liensAAnnuler } = await supabase
            .from('reservation_appareils').select('appareil_id').eq('reservation_id', id);
          for (const l of (liensAAnnuler || [])) {
            await releaseAppareilFromReservation(supabase, {
              appareilId: l.appareil_id, reservationId: id, cityId: before.city_id,
              motif: patch.statut === 'remboursee' ? 'réservation remboursée' : 'réservation annulée',
            });
          }
        } else {
          await pushToAdmin(supabase, {
            title: '⚠️ Remboursement — récupération à vérifier',
            body:  `Dossier ${before.ref || '?'} remboursé, le climatiseur est encore chez le client — vérifie que la mission de récupération est bien planifiée.`,
            tag:   `remboursement-livraison-faite-${id}`,
          });
        }
      } else {
        // Une correction faite ici (mauvaise adresse, étage, instructions
        // d'accès, téléphone...) doit remonter jusqu'au transporteur déjà en
        // mission sur cette réservation — sans ça il continue de rouler vers
        // les anciennes coordonnées jusqu'au prochain rafraîchissement.
        // Jamais dans la branche 'annulee' ci-dessus : ses missions sont
        // annulées et déjà notifiées séparément (type 'annulation').
        const CHAMPS_MISSION = ['adresse', 'etage', 'ascenseur', 'fenetre', 'installation', 'instructions_acces', 'creneau', 'tel', 'tel_secondaire'];
        if (CHAMPS_MISSION.some(k => patch[k] !== undefined)) {
          const { data: livAPrevenir } = await supabase
            .from('livraisons').select('id, transporteur_id')
            .eq('reservation_id', id)
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

      // Si la quantité change sur une réservation déjà confirmée, réconcilier les
      // appareils assignés : en assigner de nouveaux si elle augmente, en libérer
      // si elle diminue (sans quoi le nombre d'appareils "engagés" resterait faux).
      const effectifStatut = patch.statut || before.statut;
      if (patch.quantite != null && effectifStatut === 'confirmee' && patch.quantite !== before.quantite) {
        const diff = patch.quantite - before.quantite;
        if (diff > 0) {
          const disponibles = await getAvailability(supabase, before.city_id, before.date_debut, before.date_fin);
          if (disponibles < diff) {
            return res.status(409).json({ error: `Plus assez d'appareils disponibles pour augmenter la quantité (${Math.max(0, disponibles)} dispo sur ces dates).` });
          }
          await supabase.rpc('assign_appareils', {
            p_reservation_id: id, p_city_id: before.city_id, p_quantite: diff,
            p_date_debut: before.date_debut, p_date_fin: before.date_fin,
          });
          await notifyIfSoldOut(supabase, before.city_id);
        } else {
          const { data: toFree } = await supabase
            .from('reservation_appareils').select('id, appareil_id').eq('reservation_id', id)
            .order('id', { ascending: false }).limit(-diff);
          for (const ra of (toFree || [])) {
            await releaseAppareilFromReservation(supabase, {
              appareilId: ra.appareil_id, reservationId: id, cityId: before.city_id,
              motif: 'quantité de la réservation réduite',
            });
          }
        }
      }

      return res.status(200).json({ ok: true });
    }

    // Validation administrative de l'attribution d'un appareil (Module 6,
    // Partie 6) : "réservé en attente validation" -> "réservation confirmée".
    // Oversight uniquement — ne bloque rien d'autre dans le parcours.
    if (action === 'valider_appareils') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { data: owned } = await supabase.from('reservations').select('id').eq('id', id).eq('city_id', city.id).maybeSingle();
      if (!owned) return res.status(404).json({ error: 'Réservation introuvable' });
      const { error } = await supabase.from('reservation_appareils')
        .update({ valide: true, valide_at: new Date().toISOString() })
        .eq('reservation_id', id).eq('valide', false);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // Remboursement direct depuis l'admin (Module 7, Partie 21) — réservé aux
    // rôles finances (administrateur/comptabilité). N'écrit jamais
    // reservations.statut ici : le webhook Stripe existant (charge.refunded,
    // voir webhook.js) s'en charge dès que Stripe confirme le remboursement,
    // exactement comme pour un remboursement fait à la main dans Stripe —
    // cette action ne fait qu'appeler Stripe et garder une trace propre de
    // qui a demandé quoi, au lieu de la noyer dans les incidents.
    if (action === 'rembourser') {
      if (!roleHasAccess(admin.role, 'finances')) return res.status(403).json({ error: "Ton compte n'a pas accès aux remboursements." });
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const raison = (body.raison || '').trim().slice(0, 500);
      if (!raison) return res.status(400).json({ error: 'Indique la raison du remboursement' });

      const { data: resa } = await supabase
        .from('reservations').select('id, statut, prix_total_cents, stripe_payment_intent_id, ref')
        .eq('id', id).eq('city_id', city.id).maybeSingle();
      if (!resa) return res.status(404).json({ error: 'Réservation introuvable' });
      if (!resa.stripe_payment_intent_id) return res.status(400).json({ error: "Cette réservation n'a pas de paiement Stripe associé" });
      if (resa.statut === 'remboursee') return res.status(400).json({ error: 'Cette réservation est déjà remboursée' });

      const montantCents = body.montant_cents != null ? Math.max(0, parseInt(body.montant_cents) || 0) : resa.prix_total_cents;
      if (!montantCents) return res.status(400).json({ error: 'Montant invalide' });
      if (resa.prix_total_cents && montantCents > resa.prix_total_cents) {
        return res.status(400).json({ error: `Le montant (${(montantCents/100).toFixed(2)} €) dépasse le prix total de la réservation (${(resa.prix_total_cents/100).toFixed(2)} €)` });
      }

      let refund;
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        refund = await stripe.refunds.create({
          payment_intent: resa.stripe_payment_intent_id,
          amount: montantCents,
          reason: 'requested_by_customer',
        });
      } catch (stripeErr) {
        return res.status(400).json({ error: `Stripe a refusé le remboursement : ${stripeErr.message}` });
      }

      const { error: insertErr } = await supabase.from('remboursements').insert({
        reservation_id: id,
        montant_cents: montantCents,
        raison,
        stripe_refund_id: refund.id,
        demande_par: admin.nom || admin.role,
      });
      if (insertErr) {
        console.error('[rembourser] CRITIQUE — Stripe OK mais enregistrement DB échoué:', insertErr.message, '| refund_id:', refund.id, '| reservation:', id);
      }

      return res.status(200).json({ ok: true, refund_id: refund.id, audit_ok: !insertErr });
    }

    if (action === 'remboursements_list') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { data: owned } = await supabase.from('reservations').select('id').eq('id', id).eq('city_id', city.id).maybeSingle();
      if (!owned) return res.status(404).json({ error: 'Réservation introuvable' });
      const { data, error } = await supabase
        .from('remboursements').select('*').eq('reservation_id', id).order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ remboursements: data || [] });
    }

    if (action === 'window_photo_url') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { data: resa } = await supabase
        .from('reservations').select('fenetre_photo_path').eq('id', id).eq('city_id', city.id).maybeSingle();
      if (!resa || !resa.fenetre_photo_path) return res.status(404).json({ error: 'Photo introuvable' });
      const { data, error } = await supabase.storage.from('missions').createSignedUrl(resa.fenetre_photo_path, 3600);
      if (error) throw error;
      return res.status(200).json({ url: data.signedUrl });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin reservations]', err.message);
    // Message d'erreur réel plutôt qu'un "Erreur serveur" générique — cet
    // endpoint est déjà réservé à l'admin authentifié (checkAdminRole
    // ci-dessus), rien à cacher ici qui ne le soit pas déjà pour lui. Un
    // "Erreur serveur" muet obligeait jusqu'ici à consulter les logs Vercel
    // (inaccessibles à Aly) pour la moindre panne — voir l'incident du
    // 30/07/2026 (bouton "Créer — paiement à finaliser").
    return res.status(500).json({ error: String(err.message || err).slice(0, 300) });
  }
};
