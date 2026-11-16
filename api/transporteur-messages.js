const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');
const { pushToAdmin } = require('./_lib/push');

// Messages éclair avec l'admin (demande d'Aly, 2026-11-16) — canal libre,
// distinct du centre de notifications (transporteur-notifications.js, qui
// ne porte que des événements système à sens unique). Un seul fil par
// transporteur : toujours avec "l'admin" au sens large (compte partagé),
// jamais avec une personne en particulier.
const CONTENU_MAX = 500;

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
        .from('messages_transporteur')
        .select('id, expediteur, contenu, lu, created_at')
        .eq('transporteur_id', transporteurId)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      const messages = data || [];
      const nonLues = messages.filter(m => m.expediteur === 'admin' && !m.lu).length;
      return res.status(200).json({ messages, non_lues: nonLues });
    }

    if (action === 'envoyer') {
      const contenu = String(body.contenu || '').trim().slice(0, CONTENU_MAX);
      if (!contenu) return res.status(400).json({ error: 'Message vide' });

      const { data: msg, error } = await supabase
        .from('messages_transporteur')
        .insert({ transporteur_id: transporteurId, expediteur: 'transporteur', contenu })
        .select('id, expediteur, contenu, lu, created_at')
        .single();
      if (error) throw error;

      const { data: t } = await supabase.from('transporteurs').select('nom').eq('id', transporteurId).maybeSingle();
      // Best-effort : un push manqué ne doit jamais empêcher l'envoi du message
      // lui-même, déjà enregistré ci-dessus.
      await pushToAdmin(supabase, {
        title: `💬 ${t?.nom || 'Un transporteur'}`,
        body:  contenu,
        tag:   `message-${transporteurId}`,
      });
      return res.status(200).json({ ok: true, message: msg });
    }

    if (action === 'marquer_lu') {
      const { error } = await supabase.from('messages_transporteur')
        .update({ lu: true }).eq('transporteur_id', transporteurId).eq('expediteur', 'admin').eq('lu', false);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Transporteur messages]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
