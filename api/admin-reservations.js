const Stripe = require('stripe');
const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity, notifyIfSoldOut } = require('./_lib/city');
const { getAvailability } = require('./_lib/stock');
const { isValidDate, addDays } = require('./_lib/dates');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');
const { confirmReservation, sendConfirmationCommunications, sendProlongationConfirmation } = require('./_lib/reservations');
const { fmtDate } = require('./_lib/emailEngine');
const { computeOrderStatus } = require('./_lib/orderStatus');
const { syncStatutDetaille } = require('./_lib/statutDetaille');
const { INCIDENT_OPEN_STATUSES } = require('./_lib/incidentStatus');
const { notifyTransporteur } = require('./_lib/transporteurNotif');

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
      if (ids.length) {
        const [{ data: livs }, { data: incs }, { data: ras }] = await Promise.all([
          supabase.from('livraisons').select('reservation_id, type, statut, fait_at').in('reservation_id', ids),
          supabase.from('incidents').select('reservation_id').in('reservation_id', ids).in('statut', INCIDENT_OPEN_STATUSES),
          supabase.from('reservation_appareils').select('reservation_id, valide').in('reservation_id', ids),
        ]);
        for (const l of (livs || [])) {
          if (!livraisonsByResa.has(l.reservation_id)) livraisonsByResa.set(l.reservation_id, []);
          livraisonsByResa.get(l.reservation_id).push(l);
        }
        incidentResaIds = new Set((incs || []).map(i => i.reservation_id));
        // Attribution appareil "en attente de validation" (Module 6, Partie 6) :
        // au moins un appareil pas encore validé par l'administration.
        appareilsEnAttenteResaIds = new Set((ras || []).filter(r => !r.valide).map(r => r.reservation_id));
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
      const tel     = (body.tel     || '').trim().slice(0, 50);
      const telSecondaire = (body.tel_secondaire || '').trim().slice(0, 50);
      const typeClient = body.type_client === 'entreprise' ? 'entreprise' : 'particulier';
      const raisonSociale = (body.raison_sociale || '').trim().slice(0, 300);
      const siret   = (body.siret   || '').trim().slice(0, 50);
      // Minuscules, comme checkout.js — cohérence avec toutes les recherches
      // par email (connexion espace client, prolongation).
      const email   = (body.email   || '').trim().toLowerCase().slice(0, 200);
      const adresse = (body.adresse || '').trim().slice(0, 500);
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
      if (!isValidDate(dateDebut)) dateDebut = new Date().toISOString().slice(0, 10);
      let dateFin = (body.date_fin || '').slice(0, 10);
      if (!isValidDate(dateFin) || dateFin <= dateDebut) {
        const d = new Date(dateDebut + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() + 7);
        dateFin = d.toISOString().slice(0, 10);
      }
      const quantite   = Math.min(5, Math.max(1, parseInt(body.quantite) || 1));
      const prixTotalCents = Math.max(0, parseInt(body.prix_total_cents) || 0);
      const logement    = (body.logement     || '').trim().slice(0, 100);
      const parrainCode = (body.parrain_code || '').trim().slice(0, 50);
      const motifs      = (body.motifs       || '').trim().slice(0, 300);
      const mktConsent  = Boolean(body.mkt_consent);
      // Une réservation prise par téléphone pour un client qui va payer
      // lui-même via un lien envoyé ensuite (ex. personne âgée pas à l'aise
      // avec le site) reste "en attente" — le circuit de confirmation normal
      // (webhook Stripe) s'en charge une fois le paiement fait. Par défaut
      // true pour ne pas changer le comportement des appelants existants.
      const confirmerImmediat = body.confirmer !== false;

      if (!prenom) prenom = 'Client';

      const disponibles = await getAvailability(supabase, city.id, dateDebut, dateFin);
      if (disponibles < quantite) {
        return res.status(409).json({ error: `Plus assez d'appareils disponibles (${Math.max(0, disponibles)} dispo sur ces dates)` });
      }

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

      const ref = `MANUEL-${Date.now().toString(36).toUpperCase()}`;
      const { data: resa, error } = await supabase.from('reservations').insert({
        city_id: city.id, ref, prenom, nom, tel, tel_secondaire: telSecondaire || null,
        type_client: typeClient, raison_sociale: raisonSociale || null, siret: siret || null,
        email, adresse,
        etage: etage || null, ascenseur: ascenseur || null, fenetre: fenetre || null,
        installation: installation || null, instructions_acces: instructionsAcces || null,
        creneau: creneau || null,
        date_debut: dateDebut, date_fin: dateFin, quantite,
        prix_total_cents: prixTotalCents, statut: 'en_attente', source: 'manuel',
        logement: logement || null, parrain_code: parrainCode || null,
        motifs: motifs || null, mkt_consent: mktConsent,
      }).select().single();
      if (error) throw error;

      if (!confirmerImmediat) {
        return res.status(200).json({ ok: true, ref, en_attente: true, reservation: { ...resa, masquee: false } });
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
      const promoCode     = (body.promo_code || '').trim().toUpperCase().slice(0, 50);
      const prixTotalCents = Math.max(0, parseInt(body.prix_total_cents) || 0);
      const confirmerImmediat = body.confirmer !== false;

      if (!origId || !isValidDate(newDateFin)) {
        return res.status(400).json({ error: 'Réservation d\'origine et nouvelle date requises' });
      }

      const { data: orig, error: origErr } = await supabase
        .from('reservations')
        .select('id, ref, prenom, nom, tel, tel_secondaire, email, adresse, date_debut, date_fin, quantite, statut, hors_zone, etage, ascenseur, fenetre, fenetre_photo_path, installation, instructions_acces, creneau, logement')
        .eq('id', origId).eq('city_id', city.id).maybeSingle();
      if (origErr) throw origErr;
      if (!orig) return res.status(404).json({ error: 'Réservation d\'origine introuvable' });
      if (['annulee', 'remboursee'].includes(orig.statut)) {
        return res.status(422).json({ error: 'Cette réservation ne peut pas être prolongée.' });
      }
      if (newDateFin <= orig.date_fin) {
        return res.status(400).json({ error: `La nouvelle date doit être postérieure au ${orig.date_fin}.` });
      }

      const disponibles = await getAvailability(supabase, city.id, orig.date_fin, newDateFin);
      if (disponibles < (orig.quantite || 1)) {
        return res.status(409).json({ error: `Plus assez d'appareils disponibles (${Math.max(0, disponibles)} dispo sur ces dates)` });
      }

      const ref = `PROLONG-MANUEL-${Date.now().toString(36).toUpperCase()}`;
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
        parrain_code: promoCode || null,
      }).select().single();
      if (error) throw error;

      if (!confirmerImmediat) {
        return res.status(200).json({ ok: true, ref, en_attente: true, reservation: { ...resa, masquee: false } });
      }
      await confirmReservation(supabase, resa);
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
          prenom:           resa.prenom,
          nom:              resa.nom,
          jours:            joursSupplementaires,
          dateRecuperation: fmtDate(addDays(resa.date_fin, 1), resa.lang || 'fr'),
          creneau:          resa.creneau,
          amount:           ((resa.prix_total_cents || 0) / 100).toFixed(2) + ' €',
          lang:             resa.lang || 'fr',
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
        await confirmReservation(supabase, before);
        // Même communications qu'une confirmation à la création (voir action
        // "create" ci-dessus) — cette confirmation manuelle (ex. réservation
        // laissée "en attente" à la création, confirmée plus tard) doit
        // envoyer les mêmes emails/SMS/documents qu'un paiement en ligne.
        try {
          if (before.source === 'site_prolongation') {
            const joursSupplementaires = Math.round((new Date(before.date_fin + 'T00:00:00Z') - new Date(before.date_debut + 'T00:00:00Z')) / 86400000);
            await sendProlongationConfirmation(supabase, {
              reservationId:    before.id,
              email:            before.email,
              prenom:           before.prenom,
              nom:              before.nom,
              jours:            joursSupplementaires,
              dateRecuperation: fmtDate(addDays(before.date_fin, 1), before.lang || 'fr'),
              creneau:          before.creneau,
              amount:           ((before.prix_total_cents || 0) / 100).toFixed(2) + ' €',
              lang:             before.lang || 'fr',
            });
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
      if (body.tel != null)    patch.tel    = body.tel.trim().slice(0, 50);
      if (body.adresse != null) patch.adresse = body.adresse.trim().slice(0, 500);
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
      if (body.tel_secondaire != null)     patch.tel_secondaire     = body.tel_secondaire.trim().slice(0, 50) || null;
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

      // Annuler une réservation doit aussi annuler ses missions non terminées —
      // sinon un transporteur peut encore voir/accomplir une livraison pour une
      // commande annulée. Les missions déjà "fait" restent intactes (travail réel
      // déjà effectué, le transporteur reste payé).
      if (patch.statut === 'annulee') {
        const { data: livAAnnuler } = await supabase
          .from('livraisons').select('id, transporteur_id')
          .eq('reservation_id', id)
          .in('statut', ['a_faire', 'acceptee', 'en_route', 'arrivee', 'probleme']);
        await supabase.from('livraisons').update({ statut: 'annule' })
          .eq('reservation_id', id)
          .in('statut', ['a_faire', 'acceptee', 'en_route', 'arrivee', 'probleme']);
        const transpAPrevenir = new Set((livAAnnuler || []).filter(l => l.transporteur_id).map(l => l.transporteur_id));
        for (const tid of transpAPrevenir) {
          await notifyTransporteur(supabase, tid, {
            type: 'annulation', message: 'Une mission a été annulée.', tag: 'annulation',
          });
        }
      }

      // Si la quantité change sur une réservation déjà confirmée, réconcilier les
      // appareils assignés : en assigner de nouveaux si elle augmente, en libérer
      // si elle diminue (sans quoi le nombre d'appareils "engagés" resterait faux).
      if (patch.quantite != null && before.statut === 'confirmee' && patch.quantite !== before.quantite) {
        const diff = patch.quantite - before.quantite;
        if (diff > 0) {
          await supabase.rpc('assign_appareils', {
            p_reservation_id: id, p_city_id: before.city_id, p_quantite: diff,
            p_date_debut: before.date_debut, p_date_fin: before.date_fin,
          });
          await notifyIfSoldOut(supabase, before.city_id);
        } else {
          const { data: toFree } = await supabase
            .from('reservation_appareils').select('id').eq('reservation_id', id)
            .order('id', { ascending: false }).limit(-diff);
          if (toFree && toFree.length) {
            await supabase.from('reservation_appareils').delete().in('id', toFree.map(r => r.id));
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

      await supabase.from('remboursements').insert({
        reservation_id: id,
        montant_cents: montantCents,
        raison,
        stripe_refund_id: refund.id,
        demande_par: admin.nom || admin.role,
      });

      return res.status(200).json({ ok: true, refund_id: refund.id });
    }

    if (action === 'remboursements_list') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
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
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
