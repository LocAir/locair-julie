const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity } = require('./_lib/city');
const { getAvailability } = require('./_lib/stock');
const { isValidDate }     = require('./_lib/dates');
const { checkAdminToken } = require('./_lib/auth');
const { confirmReservation } = require('./_lib/reservations');

const RESA_LABEL_FR = { en_attente: 'en attente', confirmee: 'confirmée', annulee: 'annulée', terminee: 'terminée' };

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
      const { data, error } = await supabase
        .from('reservations')
        .select('id, ref, prenom, nom, tel, tel_secondaire, email, adresse, etage, ascenseur, fenetre, fenetre_photo_path, instructions_acces, creneau, date_debut, date_fin, quantite, prix_total_cents, statut, source, masquee, hors_zone, type_client, raison_sociale, siret, created_at')
        .eq('city_id', city.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return res.status(200).json({ reservations: data || [] });
    }

    // Réservation prise en direct par l'admin (téléphone, WhatsApp...). Créée
    // puis confirmée immédiatement : contrairement à un panier du site, il n'y a
    // pas de risque d'abandon puisque l'admin sait déjà que le client s'engage.
    if (action === 'create') {
      const prenom  = (body.prenom  || '').trim().slice(0, 200);
      const nom     = (body.nom     || '').trim().slice(0, 200);
      const tel     = (body.tel     || '').trim().slice(0, 50);
      const telSecondaire = (body.tel_secondaire || '').trim().slice(0, 50);
      const typeClient = body.type_client === 'entreprise' ? 'entreprise' : 'particulier';
      const raisonSociale = (body.raison_sociale || '').trim().slice(0, 300);
      const siret   = (body.siret   || '').trim().slice(0, 50);
      const email   = (body.email   || '').trim().slice(0, 200);
      const adresse = (body.adresse || '').trim().slice(0, 500);
      const etage       = (body.etage       || '').trim().slice(0, 50);
      const ascenseur   = (body.ascenseur   || '').trim().slice(0, 50);
      const fenetre     = (body.fenetre     || '').trim().slice(0, 100);
      const installation = (body.installation || '').trim().slice(0, 100);
      const instructionsAcces = (body.instructions_acces || '').trim().slice(0, 1000);
      const creneau     = (body.creneau_livraison || '').trim().slice(0, 500);
      const dateDebut = (body.date_debut || '').slice(0, 10);
      const dateFin    = (body.date_fin   || '').slice(0, 10);
      const quantite   = Math.min(5, Math.max(1, parseInt(body.quantite) || 1));
      const prixTotalCents = Math.max(0, parseInt(body.prix_total_cents) || 0);

      if (!prenom || !nom || !adresse) return res.status(400).json({ error: 'Prénom, nom et adresse requis' });
      if (!isValidDate(dateDebut) || !isValidDate(dateFin) || dateFin <= dateDebut) {
        return res.status(400).json({ error: 'Dates invalides' });
      }

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
      }).select().single();
      if (error) throw error;

      await confirmReservation(supabase, resa);
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
        return res.status(200).json({ ok: true });
      }

      const patch = {};
      if (body.statut != null)   patch.statut   = body.statut;
      if (body.quantite != null) patch.quantite = Math.max(1, parseInt(body.quantite) || 1);
      if (body.prix_total_cents != null) patch.prix_total_cents = Math.max(0, parseInt(body.prix_total_cents) || 0);
      // "Masquer" retire juste la réservation de la liste affichée à l'admin (ex.
      // doublon créé par erreur) — ça ne touche ni le statut, ni le stock, ni les
      // missions, contrairement à "Annuler". Réversible via "Restaurer".
      if (body.masquee != null) patch.masquee = !!body.masquee;
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
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Rien à modifier' });
      const { error } = await supabase.from('reservations').update(patch).eq('id', id).eq('city_id', city.id);
      if (error) throw error;

      // Annuler une réservation doit aussi annuler ses missions non terminées —
      // sinon un transporteur peut encore voir/accomplir une livraison pour une
      // commande annulée. Les missions déjà "fait" restent intactes (travail réel
      // déjà effectué, le transporteur reste payé).
      if (patch.statut === 'annulee') {
        await supabase.from('livraisons').update({ statut: 'annule' })
          .eq('reservation_id', id)
          .in('statut', ['a_faire', 'acceptee', 'arrivee', 'probleme']);
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

    if (action === 'window_photo_url') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { data: resa } = await supabase
        .from('reservations').select('fenetre_photo_path').eq('id', id).eq('city_id', city.id).maybeSingle();
      if (!resa || !resa.fenetre_photo_path) return res.status(404).json({ error: 'Photo introuvable' });
      const { data, error } = await supabase.storage.from('missions').createSignedUrl(resa.fenetre_photo_path, 300);
      if (error) throw error;
      return res.status(200).json({ url: data.signedUrl });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin reservations]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
