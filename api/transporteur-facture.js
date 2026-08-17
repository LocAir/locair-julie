const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');
const { genererFactureTransporteur, resumePeriode } = require('./_lib/transporteurFacture');

function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s || '');
}

// Facture hebdomadaire d'un transporteur à destination de Loc'Air (demande
// d'Aly, 2026-08-17) : le transporteur choisit une semaine depuis "Mes
// gains", voit un aperçu (missions + montant), valide — la facture PDF est
// générée, envoyée par email à l'administration, et reste consultable ici
// (action 'list') et dans l'admin (voir admin-virements.js).
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const transporteurId = await verifyTransporteurToken(req, supabase);
  if (!transporteurId) return res.status(401).json({ error: 'Session invalide' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    if (action === 'list') {
      const { data, error } = await supabase
        .from('transporteur_factures')
        .select('id, numero, periode_debut, periode_fin, nb_missions, montant_total_cents, envoyee_admin, access_token, created_at')
        .eq('transporteur_id', transporteurId)
        .order('periode_debut', { ascending: false })
        .limit(100);
      if (error) throw error;
      return res.status(200).json({ factures: data || [] });
    }

    if (action === 'resume_semaine' || action === 'generer') {
      const periodeDebut = String(body.periode_debut || '');
      const periodeFin   = String(body.periode_fin   || '');
      if (!isValidDate(periodeDebut) || !isValidDate(periodeFin) || periodeFin < periodeDebut) {
        return res.status(400).json({ error: 'Période invalide' });
      }

      if (action === 'resume_semaine') {
        const { data: existante } = await supabase
          .from('transporteur_factures')
          .select('id, numero, periode_debut, periode_fin, nb_missions, montant_total_cents, access_token, created_at')
          .eq('transporteur_id', transporteurId).eq('periode_debut', periodeDebut).eq('periode_fin', periodeFin)
          .maybeSingle();
        if (existante) return res.status(200).json({ deja_generee: true, facture: existante });

        const resume = await resumePeriode(supabase, transporteurId, periodeDebut, periodeFin);
        return res.status(200).json({ deja_generee: false, ...resume });
      }

      // action === 'generer'
      try {
        const result = await genererFactureTransporteur(supabase, { transporteurId, periodeDebut, periodeFin });
        return res.status(200).json({ ok: true, ...result });
      } catch (e) {
        if (e.code === 'EMPTY') return res.status(400).json({ error: e.message });
        throw e;
      }
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Transporteur facture]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
