const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');
const { pushToAdmin } = require('./_lib/push');

function startOfDayISO() {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString();
}
function startOfMonthISO() {
  const d = new Date(); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); return d.toISOString();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const transporteurId = await verifyTransporteurToken(req, supabase);
  if (!transporteurId) return res.status(401).json({ error: 'Session invalide' });

  const body   = req.body || {};
  const action = body.action || 'resume';

  try {
    if (action === 'resume') {
      const { data: faites, error } = await supabase
        .from('livraisons')
        .select(`
          id, type, montant_du_cents, paye, fait_at,
          reservation:reservations ( prenom, nom, adresse )
        `)
        .eq('transporteur_id', transporteurId)
        .eq('statut', 'fait')
        .order('fait_at', { ascending: false })
        .limit(300);
      if (error) throw error;

      const todayISO = startOfDayISO();
      const monthISO = startOfMonthISO();
      let missionsAujourdhui = 0, gainAujourdhui = 0;
      let missionsMois = 0, gainMois = 0;
      let nonVerse = 0;

      for (const f of (faites || [])) {
        const cents = f.montant_du_cents || 0;
        if (f.fait_at >= todayISO) { missionsAujourdhui++; gainAujourdhui += cents; }
        if (f.fait_at >= monthISO) { missionsMois++; gainMois += cents; }
        if (!f.paye) nonVerse += cents;
      }

      const { data: virements } = await supabase
        .from('virements')
        .select('id, montant_cents, statut, created_at, verse_at')
        .eq('transporteur_id', transporteurId)
        .order('created_at', { ascending: false })
        .limit(10);

      return res.status(200).json({
        missions_aujourdhui: missionsAujourdhui,
        gain_aujourdhui_euros: gainAujourdhui / 100,
        missions_mois: missionsMois,
        gain_mois_euros: gainMois / 100,
        non_verse_euros: nonVerse / 100,
        virements: virements || [],
        // Historique mission par mission — pour que le livreur retrouve ce
        // qu'il a fait et gagné sur chacune, pas seulement des totaux.
        missions: (faites || []).map(f => ({
          id: f.id, type: f.type, montant_cents: f.montant_du_cents || 0,
          paye: f.paye, fait_at: f.fait_at,
          client:  [f.reservation?.prenom, f.reservation?.nom].filter(Boolean).join(' ') || null,
          adresse: f.reservation?.adresse || null,
        })),
      });
    }

    if (action === 'demander_virement') {
      const { data: faites } = await supabase
        .from('livraisons').select('montant_du_cents').eq('transporteur_id', transporteurId).eq('statut', 'fait').eq('paye', false);
      const montant = (faites || []).reduce((s, f) => s + (f.montant_du_cents || 0), 0);
      if (montant <= 0) return res.status(400).json({ error: 'Aucun montant à virer pour le moment' });

      const { data: enCours } = await supabase
        .from('virements').select('id').eq('transporteur_id', transporteurId).eq('statut', 'demande').limit(1);
      if (enCours && enCours.length) return res.status(409).json({ error: 'Une demande est déjà en cours' });

      const { error } = await supabase.from('virements').insert({ transporteur_id: transporteurId, montant_cents: montant, statut: 'demande' });
      if (error) throw error;

      const { data: t } = await supabase.from('transporteurs').select('nom').eq('id', transporteurId).maybeSingle();
      await pushToAdmin(supabase, {
        title: '💶 Virement demandé',
        body:  `${t?.nom || 'Un transporteur'} demande un virement de ${(montant / 100).toFixed(2)} €.`,
        tag:   'virement',
      });

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Transporteur earnings]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
