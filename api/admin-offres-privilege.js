const Stripe = require('stripe');
const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');

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

  try {
    if (action === 'list') {
      // Inclut aussi les offres "acceptee" (climatiseur déjà vendu) pour que
      // l'admin puisse encore les voir et déclencher un remboursement dessus —
      // seules les offres refusées/annulées disparaissent de cette liste.
      const { data: offres, error } = await supabase
        .from('offres_privilege').select('*')
        .in('statut', ['eligible', 'proposee', 'acceptee'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      const list = offres || [];
      const appareilIds = [...new Set(list.map(o => o.appareil_id))];
      const reservationIds = [...new Set(list.map(o => o.reservation_id).filter(Boolean))];
      const [{ data: appareils }, { data: reservations }] = await Promise.all([
        appareilIds.length ? supabase.from('appareils').select('id, numero').in('id', appareilIds) : { data: [] },
        reservationIds.length ? supabase.from('reservations').select('id, ref, prenom, nom, date_debut, date_fin').in('id', reservationIds) : { data: [] },
      ]);
      const appareilById = new Map((appareils || []).map(a => [a.id, a]));
      const resaById = new Map((reservations || []).map(r => [r.id, r]));
      const enrichies = list.map(o => ({
        ...o,
        appareil: appareilById.get(o.appareil_id) || null,
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

      const { data: offre } = await supabase.from('offres_privilege').select('id, statut').eq('id', id).maybeSingle();
      if (!offre) return res.status(404).json({ error: 'Offre introuvable' });
      if (offre.statut !== 'eligible') return res.status(400).json({ error: 'Cette offre a déjà été traitée' });

      const { error } = await supabase.from('offres_privilege')
        .update({ statut: 'proposee', prix_vente_cents: prixCents }).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // Crée et propose directement une offre pour une réservation précise —
    // sans attendre la détection automatique du cron (seuil de locations,
    // milieu de séjour). Pour un cas particulier (le client demande
    // lui-même à garder son climatiseur, ou décision ponctuelle de l'admin).
    if (action === 'creer_manuelle') {
      const reservationId = parseInt(body.reservation_id);
      const prixCents = Math.max(1, parseInt(body.prix_vente_cents) || 0);
      if (!reservationId) return res.status(400).json({ error: 'reservation_id manquant' });
      if (!prixCents) return res.status(400).json({ error: 'Prix invalide' });

      const { data: liens } = await supabase
        .from('reservation_appareils').select('appareil_id').eq('reservation_id', reservationId);
      const appareilIds = [...new Set((liens || []).map(l => l.appareil_id))];
      if (!appareilIds.length) return res.status(400).json({ error: 'Aucun climatiseur assigné à cette réservation' });
      if (appareilIds.length > 1) return res.status(400).json({ error: 'Cette réservation a plusieurs climatiseurs — impossible de savoir lequel proposer' });
      const appareilId = appareilIds[0];

      const { data: existante } = await supabase
        .from('offres_privilege').select('id')
        .eq('appareil_id', appareilId).eq('reservation_id', reservationId).maybeSingle();
      if (existante) return res.status(400).json({ error: 'Une offre existe déjà pour ce climatiseur et cette réservation' });

      const { count } = await supabase
        .from('reservation_appareils').select('id', { count: 'exact', head: true }).eq('appareil_id', appareilId);

      const { data: created, error } = await supabase.from('offres_privilege').insert({
        appareil_id: appareilId, reservation_id: reservationId,
        nb_locations: count || 0, statut: 'proposee', prix_vente_cents: prixCents,
      }).select('id').single();
      if (error) throw error;
      return res.status(200).json({ ok: true, id: created.id });
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
        .from('offres_privilege').select('id, statut, prix_vente_cents, reservation_id, stripe_payment_intent_id')
        .eq('id', id).maybeSingle();
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
