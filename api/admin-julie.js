// Onglet admin "Julie" — conversations WhatsApp de l'agent IA
// Actions : list, get, opt_out, opt_in, clear
const { getSupabase }    = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin    = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    // ── Liste de toutes les conversations (résumé) ────────────────────────
    if (action === 'list') {
      const [convRes, optRes] = await Promise.all([
        supabase
          .from('whatsapp_conversations')
          .select('phone, messages, updated_at')
          .order('updated_at', { ascending: false })
          .limit(200),
        supabase
          .from('whatsapp_opt_out')
          .select('phone'),
      ]);
      if (convRes.error) throw convRes.error;

      const optedOut = new Set((optRes.data || []).map(r => r.phone));

      const conversations = (convRes.data || []).map(row => {
        const msgs  = row.messages || [];
        const last  = msgs[msgs.length - 1] || null;
        const first = msgs.find(m => m.role === 'user');
        return {
          phone:      row.phone,
          updated_at: row.updated_at,
          nb_messages: msgs.length,
          opted_out:  optedOut.has(row.phone),
          first_msg:  first?.content?.slice(0, 80) || '',
          last_role:  last?.role || '',
          last_msg:   last?.content?.slice(0, 100) || '',
        };
      });

      return res.json({ conversations });
    }

    // ── Conversation complète pour un numéro ─────────────────────────────
    if (action === 'get') {
      const phone = body.phone;
      if (!phone) return res.status(400).json({ error: 'phone requis' });

      const [convRes, optRes] = await Promise.all([
        supabase.from('whatsapp_conversations').select('messages, updated_at').eq('phone', phone).maybeSingle(),
        supabase.from('whatsapp_opt_out').select('phone').eq('phone', phone).maybeSingle(),
      ]);

      return res.json({
        phone,
        messages:   convRes.data?.messages  || [],
        updated_at: convRes.data?.updated_at || null,
        opted_out:  !!optRes.data,
      });
    }

    // ── Opt-out manuel d'un numéro ────────────────────────────────────────
    if (action === 'opt_out') {
      const phone = body.phone;
      if (!phone) return res.status(400).json({ error: 'phone requis' });
      await supabase.from('whatsapp_opt_out').upsert({ phone }, { onConflict: 'phone' });
      return res.json({ ok: true });
    }

    // ── Réactiver un numéro (annuler opt-out) ────────────────────────────
    if (action === 'opt_in') {
      const phone = body.phone;
      if (!phone) return res.status(400).json({ error: 'phone requis' });
      await supabase.from('whatsapp_opt_out').delete().eq('phone', phone);
      return res.json({ ok: true });
    }

    // ── Effacer l'historique d'une conversation ───────────────────────────
    if (action === 'clear') {
      const phone = body.phone;
      if (!phone) return res.status(400).json({ error: 'phone requis' });
      await supabase.from('whatsapp_conversations').delete().eq('phone', phone);
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (e) {
    console.error('[admin-julie]', e.message);
    return res.status(500).json({ error: e.message });
  }
};
