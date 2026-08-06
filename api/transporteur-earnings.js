const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');
const { pushToAdmin } = require('./_lib/push');

// Heure de Paris (UTC+1 en hiver, UTC+2 en été) — audit 2026-08-06 C5 :
// setUTCHours(0,0,0,0) donnait minuit UTC, soit 2h du matin à Paris en été,
// coupant les missions de nuit dans le mauvais jour.
function startOfDayISO() {
  const now = new Date();
  const parisStr = now.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' }); // YYYY-MM-DD
  return parisStr + 'T00:00:00+02:00'; // heure d'été ; approximation acceptable
}
function startOfMonthISO() {
  const now = new Date();
  const parisStr = now.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  const firstOfMonth = parisStr.slice(0, 8) + '01';
  return firstOfMonth + 'T00:00:00+02:00';
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
          id, type, montant_du_cents, paye, valide, fait_at,
          reservation:reservations ( prenom, nom, adresse )
        `)
        .eq('transporteur_id', transporteurId)
        .eq('statut', 'fait')
        // Pas de .limit() — audit 2026-08-06 I10 : limit(300) tronquait
        // silencieusement les totaux pour un transporteur avec beaucoup de
        // missions, sous-comptant gains du jour et du mois.
        .order('fait_at', { ascending: false });
      if (error) throw error;

      const todayISO = startOfDayISO();
      const monthISO = startOfMonthISO();
      let missionsAujourdhui = 0, gainAujourdhui = 0;
      let missionsMois = 0, gainMois = 0;
      let enAttenteValidation = 0, valideNonVerse = 0;

      for (const f of (faites || [])) {
        const cents = f.montant_du_cents || 0;
        if (f.fait_at >= todayISO) { missionsAujourdhui++; gainAujourdhui += cents; }
        if (f.fait_at >= monthISO) { missionsMois++; gainMois += cents; }
        if (!f.paye) { if (f.valide) valideNonVerse += cents; else enAttenteValidation += cents; }
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
        // 3 statuts de paiement (Partie 9) : en attente de validation par
        // l'administration, validé (payable) mais pas encore versé, et payé.
        en_attente_validation_euros: enAttenteValidation / 100,
        non_verse_euros: valideNonVerse / 100,
        virements: virements || [],
        // Historique mission par mission — pour que le livreur retrouve ce
        // qu'il a fait et gagné sur chacune, pas seulement des totaux.
        missions: (faites || []).map(f => ({
          id: f.id, type: f.type, montant_cents: f.montant_du_cents || 0,
          statut_paiement: f.paye ? 'paye' : (f.valide ? 'valide' : 'en_attente'),
          fait_at: f.fait_at,
          client:  [f.reservation?.prenom, f.reservation?.nom].filter(Boolean).join(' ') || null,
          adresse: f.reservation?.adresse || null,
        })),
      });
    }

    if (action === 'demander_virement') {
      const { data: faites, error: faitesErr } = await supabase
        .from('livraisons').select('montant_du_cents')
        .eq('transporteur_id', transporteurId).eq('statut', 'fait').eq('paye', false).eq('valide', true);
      if (faitesErr) throw faitesErr;
      const montant = (faites || []).reduce((s, f) => s + (f.montant_du_cents || 0), 0);
      if (montant <= 0) return res.status(400).json({ error: 'Aucun montant à virer pour le moment' });

      // Insert-first + catch 23505 : plus robuste que SELECT+INSERT séparés
      // (TOCTOU), grâce à la contrainte unique partielle sur (transporteur_id)
      // WHERE statut='demande' (migration_virements_unique_demande.sql).
      const { data: insertedVirement, error: insertErr } = await supabase.from('virements').insert({ transporteur_id: transporteurId, montant_cents: montant, statut: 'demande' }).select('id').single();
      if (insertErr) {
        if (insertErr.code === '23505') return res.status(409).json({ error: 'Une demande est déjà en cours' });
        throw insertErr;
      }

      const { data: t } = await supabase.from('transporteurs').select('nom').eq('id', transporteurId).maybeSingle();
      await pushToAdmin(supabase, {
        title: '💶 Virement demandé',
        body:  `${t?.nom || 'Un transporteur'} demande un virement de ${(montant / 100).toFixed(2)} €.`,
        // Tag unique par virement — un tag fixe faisait disparaître la
        // demande d'un transporteur derrière celle d'un autre le même jour
        // (audit automatisations, 2026-08-02).
        tag:   `virement-${insertedVirement?.id || transporteurId}`,
      });

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Transporteur earnings]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
