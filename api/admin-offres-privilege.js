const Stripe = require('stripe');
const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');
const { resolveAdminCity } = require('./_lib/city');

// Offre Privilège (Step 2) — l'admin fixe le prix de vente d'une offre déjà
// détectée par le cron quotidien (voir cron-daily.js). Tant qu'aucun prix
// n'est fixé (statut "eligible"), le client ne voit rien — l'offre ne
// devient visible dans son espace qu'une fois passée à "proposee" ici.
// Réservé aux rôles finances (administrateur/comptabilité), comme les
// autres décisions qui engagent de l'argent (virements, remboursements).
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });
  if (!roleHasAccess(admin.role, 'finances')) return res.status(403).json({ error: "Ton compte n'a pas accès à l'Offre Privilège." });

  const body   = req.body || {};
  const action = body.action || 'list';
  // offres_privilege n'a pas de city_id direct (rattaché via appareil_id) —
  // chaque action rejoint donc appareils!inner pour cloisonner par ville,
  // comme le reste de l'admin (voir admin-stock.js, admin-dashboard.js).
  const city = await resolveAdminCity(supabase, body);
  if (!city) return res.status(400).json({ error: 'Ville introuvable' });

  try {
    if (action === 'list') {
      // Inclut aussi les offres "acceptee" (climatiseur déjà vendu) pour que
      // l'admin puisse encore les voir et déclencher un remboursement dessus —
      // seules les offres refusées/annulées disparaissent de cette liste.
      const { data: offres, error } = await supabase
        .from('offres_privilege').select('*, appareil:appareils!inner(id, numero, city_id)')
        .eq('appareil.city_id', city.id)
        .in('statut', ['eligible', 'proposee', 'acceptee'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      const list = offres || [];
      const reservationIds = [...new Set(list.map(o => o.reservation_id).filter(Boolean))];
      const { data: reservations } = reservationIds.length
        ? await supabase.from('reservations').select('id, ref, prenom, nom, date_debut, date_fin').in('id', reservationIds)
        : { data: [] };
      const resaById = new Map((reservations || []).map(r => [r.id, r]));
      const enrichies = list.map(o => ({
        ...o,
        reservation: resaById.get(o.reservation_id) || null,
      }));
      return res.status(200).json({ offres: enrichies });
    }

    // Fixe le prix et rend l'offre visible côté client ("eligible" -> "proposee").
    if (action === 'proposer') {
      const id = parseInt(body.id);
      const prixCents = Math.max(1, parseInt(body.prix_vente_cents) || 0);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      if (!prixCents) return res.status(400).json({ error: 'Prix invalide' });

      const { data: offre } = await supabase
        .from('offres_privilege').select('id, statut, appareil:appareils!inner(city_id)')
        .eq('id', id).eq('appareil.city_id', city.id).maybeSingle();
      if (!offre) return res.status(404).json({ error: 'Offre introuvable' });
      if (offre.statut !== 'eligible') return res.status(400).json({ error: 'Cette offre a déjà été traitée' });

      const { error } = await supabase.from('offres_privilege')
        .update({ statut: 'proposee', prix_vente_cents: prixCents }).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // Liste les climatiseurs d'une réservation, pour que l'admin choisisse
    // lui-même lequel (ou lesquels) proposer sur une réservation qui en a
    // plusieurs — jamais un choix automatique. Exclut ceux qui ont déjà une
    // offre (peu importe son statut) pour cette réservation précise.
    if (action === 'appareils_reservation') {
      const reservationId = parseInt(body.reservation_id);
      if (!reservationId) return res.status(400).json({ error: 'reservation_id manquant' });

      const { data: resa } = await supabase.from('reservations').select('id').eq('id', reservationId).eq('city_id', city.id).maybeSingle();
      if (!resa) return res.status(404).json({ error: 'Réservation introuvable' });

      const [{ data: liens }, { data: offresExistantes }] = await Promise.all([
        supabase.from('reservation_appareils').select('appareil_id, appareil:appareils(numero, reference)').eq('reservation_id', reservationId),
        supabase.from('offres_privilege').select('appareil_id').eq('reservation_id', reservationId),
      ]);
      const dejaOfferts = new Set((offresExistantes || []).map(o => o.appareil_id));
      const appareils = (liens || [])
        .filter(l => !dejaOfferts.has(l.appareil_id))
        .map(l => ({ id: l.appareil_id, numero: l.appareil?.numero ?? null, reference: l.appareil?.reference ?? null }));
      return res.status(200).json({ appareils });
    }

    // Crée et propose directement une ou plusieurs offres pour une réservation
    // précise — sans attendre la détection automatique du cron (seuil de
    // locations, milieu de séjour). Pour un cas particulier (le client
    // demande lui-même à garder un ou plusieurs climatiseurs, ou décision
    // ponctuelle de l'admin). Sur une réservation à plusieurs climatiseurs,
    // l'admin choisit explicitement lesquels (appareil_ids) — jamais deviné.
    if (action === 'creer_manuelle') {
      const reservationId = parseInt(body.reservation_id);
      const prixCents = Math.max(1, parseInt(body.prix_vente_cents) || 0);
      const appareilIds = Array.isArray(body.appareil_ids)
        ? [...new Set(body.appareil_ids.map(x => parseInt(x)).filter(Boolean))] : [];
      if (!reservationId) return res.status(400).json({ error: 'reservation_id manquant' });
      if (!appareilIds.length) return res.status(400).json({ error: 'Choisis au moins un climatiseur' });
      if (!prixCents) return res.status(400).json({ error: 'Prix invalide' });

      const { data: resaOwned } = await supabase.from('reservations').select('id').eq('id', reservationId).eq('city_id', city.id).maybeSingle();
      if (!resaOwned) return res.status(404).json({ error: 'Réservation introuvable' });

      const { data: liens } = await supabase
        .from('reservation_appareils').select('appareil_id').eq('reservation_id', reservationId);
      const valides = new Set((liens || []).map(l => l.appareil_id));
      const inconnu = appareilIds.find(id => !valides.has(id));
      if (inconnu) return res.status(400).json({ error: "Un des climatiseurs choisis ne fait pas partie de cette réservation" });

      const { data: existantes } = await supabase
        .from('offres_privilege').select('appareil_id').eq('reservation_id', reservationId).in('appareil_id', appareilIds);
      if ((existantes || []).length) return res.status(400).json({ error: 'Une offre existe déjà pour au moins un des climatiseurs choisis' });

      const rows = [];
      for (const appareilId of appareilIds) {
        // + nb_locations_historique : voir bumpNbLocationsHistorique dans
        // admin-stock.js (compense les locations perdues par un échange
        // d'appareil passé, qui supprime la ligne reservation_appareils).
        const [{ count }, { data: appareilHist }] = await Promise.all([
          supabase.from('reservation_appareils').select('id', { count: 'exact', head: true }).eq('appareil_id', appareilId),
          supabase.from('appareils').select('nb_locations_historique').eq('id', appareilId).maybeSingle(),
        ]);
        const totalLocations = (count || 0) + (appareilHist?.nb_locations_historique || 0);
        rows.push({ appareil_id: appareilId, reservation_id: reservationId, nb_locations: totalLocations, statut: 'proposee', prix_vente_cents: prixCents });
      }

      const { data: created, error } = await supabase.from('offres_privilege').insert(rows).select('id');
      if (error) throw error;
      return res.status(200).json({ ok: true, ids: (created || []).map(c => c.id) });
    }

    // Rembourse un achat déjà accepté (le client change d'avis). Ne fait que
    // déclencher le remboursement Stripe + l'historiser — ne touche ni au
    // statut de l'offre ni à celui de l'appareil : c'est le webhook Stripe
    // (charge.refunded) qui remet l'appareil "disponible" et l'offre
    // "refusee" une fois le remboursement réellement confirmé par Stripe,
    // exactement comme pour le bouton "Rembourser" des locations.
    if (action === 'rembourser') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const raison = (body.raison || '').trim().slice(0, 500);
      if (!raison) return res.status(400).json({ error: 'Indique la raison du remboursement' });

      const { data: offre } = await supabase
        .from('offres_privilege').select('id, statut, prix_vente_cents, reservation_id, stripe_payment_intent_id, appareil:appareils!inner(city_id)')
        .eq('id', id).eq('appareil.city_id', city.id).maybeSingle();
      if (!offre) return res.status(404).json({ error: 'Offre introuvable' });
      if (offre.statut !== 'acceptee') return res.status(400).json({ error: "Cette offre n'a pas encore été achetée" });
      if (!offre.stripe_payment_intent_id) return res.status(400).json({ error: 'Aucun paiement Stripe associé à cette offre' });

      const montantCents = body.montant_cents != null ? Math.max(0, parseInt(body.montant_cents) || 0) : offre.prix_vente_cents;
      if (!montantCents) return res.status(400).json({ error: 'Montant invalide' });

      let refund;
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        refund = await stripe.refunds.create({
          payment_intent: offre.stripe_payment_intent_id,
          amount: montantCents,
          reason: 'requested_by_customer',
        });
      } catch (stripeErr) {
        return res.status(400).json({ error: `Stripe a refusé le remboursement : ${stripeErr.message}` });
      }

      await supabase.from('remboursements').insert({
        reservation_id:   offre.reservation_id,
        montant_cents:    montantCents,
        raison,
        stripe_refund_id: refund.id,
        demande_par:      admin.nom || admin.role,
      });

      return res.status(200).json({ ok: true, refund_id: refund.id });
    }

    // Retire une offre sans la proposer (ex. l'admin juge que non, finalement).
    if (action === 'annuler') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });

      const { data: offre } = await supabase
        .from('offres_privilege').select('id, appareil:appareils!inner(city_id)')
        .eq('id', id).eq('appareil.city_id', city.id).maybeSingle();
      if (!offre) return res.status(404).json({ error: 'Offre introuvable' });

      const { error } = await supabase.from('offres_privilege')
        .update({ statut: 'annulee', decidee_at: new Date().toISOString() })
        .eq('id', id).in('statut', ['eligible', 'proposee']);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin offres privilège]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
