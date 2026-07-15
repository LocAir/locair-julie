const { getSupabase } = require('./_lib/supabase');
const { checkAdminToken } = require('./_lib/auth');
const { SCENARIOS, sendScenarioEmail } = require('./_lib/emailEngine');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    // Historique des emails envoyés/en erreur — optionnellement filtré par
    // réservation ou par scénario, le plus récent en premier.
    if (action === 'list') {
      let query = supabase
        .from('email_log')
        .select('id, reservation_id, scenario, destinataire, statut, erreur, created_at, reservation:reservations(ref, prenom, nom)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (body.reservation_id) query = query.eq('reservation_id', parseInt(body.reservation_id));
      if (body.scenario) query = query.eq('scenario', body.scenario);
      if (body.statut) query = query.eq('statut', body.statut);
      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ emails: data || [] });
    }

    // Liste des scénarios et de leur état actif/inactif.
    if (action === 'scenarios') {
      const { data, error } = await supabase.from('email_scenarios').select('id, libelle, actif').order('id');
      if (error) throw error;
      return res.status(200).json({ scenarios: data || [] });
    }

    // Active/désactive un scénario — n'affecte que les envois futurs
    // (n'annule rien de déjà programmé, puisque tout est réévalué chaque
    // jour à partir de Supabase, jamais figé à l'avance).
    if (action === 'toggle_scenario') {
      const id = String(body.id || '');
      if (!SCENARIOS[id] && id !== 'confirmation') return res.status(400).json({ error: 'Scénario inconnu' });
      const { error } = await supabase.from('email_scenarios').update({ actif: !!body.actif }).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // Renvoi manuel d'un email de scénario pour une réservation — contourne
    // la garde "jamais deux fois" (force:true) mais reste historisé.
    if (action === 'resend') {
      const reservationId = parseInt(body.reservation_id);
      const scenario = String(body.scenario || '');
      if (!reservationId || !SCENARIOS[scenario]) {
        return res.status(400).json({ error: 'reservation_id et scenario valides requis' });
      }
      const result = await sendScenarioEmail(supabase, { reservationId, scenario, force: true });
      if (!result.sent) return res.status(422).json({ error: result.reason === 'no_email' ? 'Ce client n\'a pas d\'email enregistré' : (result.error || result.reason) });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin emails]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
