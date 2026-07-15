const { getSupabase } = require('./_lib/supabase');
const { verifyTransporteurToken } = require('./_lib/auth');
const { getActiveChecklistItems } = require('./_lib/checklistItems');

// Checklists administrables (installation / récupération) — Module 5,
// Parties 5 et 7. Récupérées une fois par l'appli transporteur pour afficher
// dynamiquement les cases à cocher avant "Installation/Récupération terminée".
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const transporteurId = await verifyTransporteurToken(req, supabase);
  if (!transporteurId) return res.status(401).json({ error: 'Session invalide' });

  const workflow = req.body?.workflow;
  if (!['installation', 'recuperation'].includes(workflow)) {
    return res.status(400).json({ error: 'workflow invalide' });
  }

  try {
    const items = await getActiveChecklistItems(supabase, workflow);
    return res.status(200).json({ items });
  } catch (err) {
    console.error('[Transporteur checklist items]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
