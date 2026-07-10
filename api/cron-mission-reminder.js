const { getSupabase } = require('./_lib/supabase');
const { pushToTransporteur } = require('./_lib/push');

function verifyCronAuth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers['authorization'] || '') === `Bearer ${secret}`;
}

// Rappel du soir : chaque transporteur ayant au moins une mission prévue
// demain reçoit une notification push (même app fermée), une par transporteur
// (pas une par mission) pour ne pas spammer une journée chargée.
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyCronAuth(req)) return res.status(401).json({ error: 'Non autorisé' });

  const supabase = getSupabase();
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  try {
    const { data: missions, error } = await supabase
      .from('livraisons')
      .select('transporteur_id')
      .eq('date_prevue', tomorrow)
      .in('statut', ['a_faire', 'acceptee'])
      .not('transporteur_id', 'is', null);
    if (error) throw error;

    const countByTransporteur = {};
    (missions || []).forEach(m => {
      countByTransporteur[m.transporteur_id] = (countByTransporteur[m.transporteur_id] || 0) + 1;
    });

    await Promise.all(Object.entries(countByTransporteur).map(([tid, count]) =>
      pushToTransporteur(supabase, parseInt(tid), {
        title: '📋 Missions demain',
        body:  `${count} mission${count > 1 ? 's' : ''} prévue${count > 1 ? 's' : ''} demain — ouvre l'app pour voir les détails.`,
        tag:   'rappel-missions-demain',
      })
    ));

    return res.status(200).json({ ok: true, transporteurs_notifies: Object.keys(countByTransporteur).length });
  } catch (err) {
    console.error('[Cron mission reminder]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
