const { getSupabase } = require('./_lib/supabase');
const { checkTransporteurToken } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkTransporteurToken(req)) return res.status(401).json({ error: 'Code incorrect' });

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('transporteurs')
      .select('id, nom')
      .eq('actif', true)
      .order('nom');
    if (error) throw error;
    return res.status(200).json({ transporteurs: data || [] });
  } catch (err) {
    console.error('[Transporteur login]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
