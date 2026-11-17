const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity, listCities } = require('./_lib/city');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');
const { pushToTransporteur } = require('./_lib/push');

// Messages éclair avec les transporteurs (demande d'Aly, 2026-11-16) — canal
// libre, distinct des push système (pushToAdmin, déclenchés automatiquement
// par les actions métier). Même domaine d'accès que admin-transporteurs.js.
const CONTENU_MAX = 500;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });
  if (!roleHasAccess(admin.role, 'transporteurs')) return res.status(403).json({ error: "Ton compte n'a pas accès aux transporteurs." });

  const body   = req.body || {};
  const action = body.action || 'list_conversations';

  try {
    if (action === 'list_conversations') {
      const city = await resolveAdminCity(supabase, body);
      if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });
      const cityIds = body.city_id === 'all' ? (await listCities(supabase)).map(c => c.id) : [city.id];

      const { data: transporteurs, error: tErr } = await supabase
        .from('transporteurs').select('id, nom').in('city_id', cityIds).order('nom');
      if (tErr) throw tErr;
      const ids = (transporteurs || []).map(t => t.id);
      if (!ids.length) return res.status(200).json({ conversations: [] });

      const { data: messages, error: mErr } = await supabase
        .from('messages_transporteur')
        .select('transporteur_id, expediteur, contenu, lu, created_at')
        .in('transporteur_id', ids)
        .order('created_at', { ascending: false });
      if (mErr) throw mErr;

      // Regroupé côté code plutôt qu'en SQL (volume faible, reste lisible) :
      // dernier message + nombre de non lus (côté admin = envoyés par le
      // transporteur) par transporteur, triés avec les non lus en premier.
      const parMessage = new Map();
      for (const t of transporteurs) parMessage.set(t.id, { transporteur: t, dernier: null, non_lues: 0 });
      for (const m of (messages || [])) {
        const c = parMessage.get(m.transporteur_id);
        if (!c) continue;
        if (!c.dernier) c.dernier = m;
        if (m.expediteur === 'transporteur' && !m.lu) c.non_lues++;
      }
      const conversations = [...parMessage.values()]
        .filter(c => c.dernier) // pas de fil = pas affiché dans la liste
        .sort((a, b) => (b.non_lues - a.non_lues) || (new Date(b.dernier.created_at) - new Date(a.dernier.created_at)));
      return res.status(200).json({ conversations });
    }

    if (action === 'list_thread') {
      const transporteurId = parseInt(body.transporteur_id);
      if (!transporteurId) return res.status(400).json({ error: 'transporteur_id manquant' });
      const { data, error } = await supabase
        .from('messages_transporteur')
        .select('id, expediteur, contenu, lu, created_at')
        .eq('transporteur_id', transporteurId)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      return res.status(200).json({ messages: data || [] });
    }

    if (action === 'envoyer') {
      const transporteurId = parseInt(body.transporteur_id);
      const contenu = String(body.contenu || '').trim().slice(0, CONTENU_MAX);
      if (!transporteurId) return res.status(400).json({ error: 'transporteur_id manquant' });
      if (!contenu) return res.status(400).json({ error: 'Message vide' });

      const { data: msg, error } = await supabase
        .from('messages_transporteur')
        .insert({ transporteur_id: transporteurId, expediteur: 'admin', contenu })
        .select('id, expediteur, contenu, lu, created_at')
        .single();
      if (error) throw error;

      // pushToTransporteur directement (pas notifyTransporteur) : ce fil a
      // sa propre table/historique, pas besoin de dupliquer dans
      // transporteur_notifications (centre d'événements système).
      await pushToTransporteur(supabase, transporteurId, {
        title: "Loc'Air", body: contenu, tag: 'message', url: '/transporteur/',
      });
      return res.status(200).json({ ok: true, message: msg });
    }

    if (action === 'marquer_lu') {
      const transporteurId = parseInt(body.transporteur_id);
      if (!transporteurId) return res.status(400).json({ error: 'transporteur_id manquant' });
      const { error } = await supabase.from('messages_transporteur')
        .update({ lu: true }).eq('transporteur_id', transporteurId).eq('expediteur', 'transporteur').eq('lu', false);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin messages]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
