const { getSupabase } = require('./_lib/supabase');
const { verifyPartenaireToken } = require('./_lib/auth');
const { pushToAdmin } = require('./_lib/push');

function startOfDayISO() {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString();
}
function startOfMonthISO() {
  const d = new Date(); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); return d.toISOString();
}
function startOfYearISO() {
  const d = new Date(); d.setUTCMonth(0, 1); d.setUTCHours(0, 0, 0, 0); return d.toISOString();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const partenaireId = await verifyPartenaireToken(req, supabase);
  if (!partenaireId) return res.status(401).json({ error: 'Session invalide' });

  const body   = req.body || {};
  const action = body.action || 'resume';

  try {
    if (action === 'resume') {
      // Deux requêtes séparées :
      // 1) stats agrégées (sans limite) — pour les totaux historiques exacts
      // 2) historique paginé (limit 300) — pour l'affichage réservation par réservation
      // Un ambassadeur actif depuis plusieurs années peut avoir 500+ réservations ;
      // mettre la même limite sur les deux tronquerait les totaux.
      const [{ data: allResas, error: allErr }, { data: resas, error }] = await Promise.all([
        supabase.from('reservations')
          .select('partenaire_commission_cents, partenaire_commission_payee, created_at')
          .eq('partenaire_id', partenaireId)
          .in('statut', ['confirmee', 'terminee'])
          .eq('masquee', false),
        supabase.from('reservations')
          .select('id, ref, prenom, nom, date_debut, date_fin, prix_total_cents, partenaire_commission_cents, partenaire_commission_payee, created_at')
          .eq('partenaire_id', partenaireId)
          .in('statut', ['confirmee', 'terminee'])
          .eq('masquee', false)
          .order('created_at', { ascending: false })
          .limit(300),
      ]);
      if (allErr) throw allErr;
      if (error) throw error;

      const todayISO = startOfDayISO();
      const monthISO = startOfMonthISO();
      const yearISO  = startOfYearISO();
      let reservationsAujourdhui = 0, gainAujourdhui = 0;
      let reservationsMois = 0, gainMois = 0;
      let nonVerse = 0, totalVerse = 0, totalAnnee = 0;

      // Statistiques sur la totalité de l'historique (pas limité à 300)
      for (const r of (allResas || [])) {
        const cents = r.partenaire_commission_cents || 0;
        if (r.created_at >= todayISO) { reservationsAujourdhui++; gainAujourdhui += cents; }
        if (r.created_at >= monthISO) { reservationsMois++; gainMois += cents; }
        if (r.partenaire_commission_payee) totalVerse += cents;
        else nonVerse += cents;
        if (r.created_at >= yearISO) totalAnnee += cents;
      }

      // Réservations en attente de paiement client — la commission n'est pas
      // encore acquise mais donne une idée du pipeline à venir.
      const { data: resasAttente } = await supabase
        .from('reservations')
        .select('partenaire_commission_cents')
        .eq('partenaire_id', partenaireId)
        .eq('statut', 'en_attente')
        .eq('masquee', false);
      const previsionAttente = (resasAttente || []).reduce((s, r) => s + (r.partenaire_commission_cents || 0), 0);

      const { data: virements } = await supabase
        .from('partenaire_virements')
        .select('id, montant_cents, statut, created_at, verse_at')
        .eq('partenaire_id', partenaireId)
        .order('created_at', { ascending: false });

      return res.status(200).json({
        reservations_aujourdhui: reservationsAujourdhui,
        gain_aujourdhui_euros:   gainAujourdhui / 100,
        reservations_mois:       reservationsMois,
        gain_mois_euros:         gainMois / 100,
        non_verse_euros:         nonVerse / 100,
        total_verse_euros:       totalVerse / 100,
        total_annee_euros:       totalAnnee / 100,
        prevision_attente_euros: previsionAttente / 100,
        virements: virements || [],
        // Historique réservation par réservation — pour que le partenaire
        // retrouve ce qu'il a apporté et gagné sur chacune, pas seulement des totaux.
        reservations_total: (allResas || []).length,
        reservations: (resas || []).map(r => {
          const fullName = [r.prenom, r.nom].filter(Boolean).join(' ');
          return {
          id: r.id, ref: r.ref,
          client: fullName.length > 30 ? fullName.slice(0, 29) + '…' : (fullName || null),
          date_debut: r.date_debut, date_fin: r.date_fin,
          montant_cents: r.prix_total_cents || 0,
          commission_cents: r.partenaire_commission_cents || 0,
          payee: r.partenaire_commission_payee,
          created_at: r.created_at,
          };
        }),
      });
    }

    if (action === 'demander_virement') {
      const { data: resas, error: resasErr } = await supabase
        .from('reservations')
        .select('partenaire_commission_cents')
        .eq('partenaire_id', partenaireId).in('statut', ['confirmee', 'terminee']).eq('masquee', false)
        .eq('partenaire_commission_payee', false);
      if (resasErr) throw resasErr;
      const montant = (resas || []).reduce((s, r) => s + (r.partenaire_commission_cents || 0), 0);
      if (montant <= 0) return res.status(400).json({ error: 'Aucun montant à virer pour le moment' });

      const { data: enCours, error: enCoursErr } = await supabase
        .from('partenaire_virements').select('id').eq('partenaire_id', partenaireId).eq('statut', 'demande').limit(1);
      if (enCoursErr) throw enCoursErr;
      if (enCours && enCours.length) return res.status(409).json({ error: 'Une demande est déjà en cours' });

      const { error } = await supabase.from('partenaire_virements').insert({ partenaire_id: partenaireId, montant_cents: montant, statut: 'demande' });
      if (error) throw error;

      const { data: p } = await supabase.from('partenaires').select('nom').eq('id', partenaireId).maybeSingle();
      await pushToAdmin(supabase, {
        title: '💶 Virement partenaire demandé',
        body:  `${p?.nom || 'Un partenaire'} demande un virement de ${(montant / 100).toFixed(2)} €.`,
        tag:   'virement-partenaire',
      });

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Partenaire earnings]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
