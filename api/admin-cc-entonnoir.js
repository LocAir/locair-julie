// Tableau de bord Click & Collect : combien de visites atteignent chaque
// étape (vue → bouton → point choisi → paiement ouvert → payé), par
// variante du titre (test A/B). Réservé à l'admin.
const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');

const ORDRE = [
  ['cc_vue', 'Ont vu la page'],
  ['cc_ticket', 'Ont touché « Trouver le point le plus proche »'],
  ['point', 'Ont choisi un point'],
  ['cc_vers_paiement', 'Ont lancé le paiement'],
  ['cc_paiement', 'Ont payé'],
];
const CHOIX_POINT = ['cc_express', 'cc_carte_point', 'cc_ville', 'cc_geoloc'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const a = await checkAdminRole(req, supabase);
  if (!a.ok) return res.status(401).json({ error: 'Non autorisé' });
  const jours = Math.min(90, Math.max(1, parseInt((req.body || {}).jours, 10) || 7));
  const depuis = new Date(Date.now() - jours * 864e5).toISOString();
  const lignes = [];
  for (let page = 0; page < 20; page++) {
    const { data, error } = await supabase.from('cc_evenements').select('evenement, variante, visite')
      .gte('cree_le', depuis).order('id', { ascending: true }).range(page * 1000, page * 1000 + 999);
    if (error) {
      if (/cc_evenements|does not exist|42P01/.test(error.message + (error.code || ''))) return res.status(200).json({ manque_table: true });
      return res.status(500).json({ error: error.message });
    }
    lignes.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const parVariante = {};
  for (const v of ['A', 'B']) {
    const visites = {};
    for (const l of lignes) {
      if (l.variante !== v) continue;
      const k = CHOIX_POINT.includes(l.evenement) ? 'point' : l.evenement;
      (visites[k] = visites[k] || new Set()).add(l.visite);
    }
    parVariante[v] = ORDRE.map(([k, libelle]) => ({ etape: k, libelle, visites: visites[k] ? visites[k].size : 0 }));
  }
  return res.status(200).json({ jours, total_evenements: lignes.length, variantes: parVariante,
    titres: { A: 'Réservez. Récupérez à …', B: 'Le frais, à deux pas de chez vous.' } });
};
