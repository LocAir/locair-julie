const { getSupabase } = require('./_lib/supabase');
const { getCity }     = require('./_lib/city');
const { checkAdminToken } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    const city = await getCity(supabase);
    // virements n'a pas de city_id direct — on passe par les transporteurs de
    // cette ville pour ne jamais faire fuiter les paiements d'une autre ville
    // partageant la même base Supabase.
    const { data: cityTransp } = await supabase.from('transporteurs').select('id').eq('city_id', city.id);
    const transpIds = (cityTransp || []).map(t => t.id);

    if (action === 'list') {
      if (!transpIds.length) return res.status(200).json({ virements: [] });
      const { data, error } = await supabase
        .from('virements')
        .select('id, montant_cents, statut, created_at, verse_at, transporteur:transporteurs ( id, nom )')
        .in('transporteur_id', transpIds)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return res.status(200).json({ virements: data || [] });
    }

    // Vue "revenus par livreur" : ce qui manquait jusqu'ici, l'admin ne voyait
    // un transporteur ici que s'il avait lui-même demandé un virement — aucune
    // visibilité sur ce qui est dû avant ça. Regroupe toutes les missions
    // terminées par transporteur, payées ou non, pour un aperçu complet
    // (montant à verser, déjà versé, détail mission par mission).
    if (action === 'summary') {
      const { data: transporteurs } = await supabase
        .from('transporteurs').select('id, nom, actif').eq('city_id', city.id).order('nom');
      const ids = (transporteurs || []).map(t => t.id);
      if (!ids.length) return res.status(200).json({ transporteurs: [] });

      const { data: faites } = await supabase
        .from('livraisons')
        .select(`
          id, type, transporteur_id, montant_du_cents, paye, fait_at,
          reservation:reservations ( prenom, nom, adresse )
        `)
        .in('transporteur_id', ids).eq('statut', 'fait')
        .order('fait_at', { ascending: false });

      const { data: demandesEnCours } = await supabase
        .from('virements').select('transporteur_id').in('transporteur_id', ids).eq('statut', 'demande');
      const enCoursSet = new Set((demandesEnCours || []).map(v => v.transporteur_id));

      const byTransp = {};
      (faites || []).forEach(f => { (byTransp[f.transporteur_id] = byTransp[f.transporteur_id] || []).push(f); });

      const result = (transporteurs || []).map(t => {
        const missions = byTransp[t.id] || [];
        const nonVerse = missions.filter(m => !m.paye).reduce((s, m) => s + (m.montant_du_cents || 0), 0);
        const verse    = missions.filter(m => m.paye).reduce((s, m) => s + (m.montant_du_cents || 0), 0);
        return {
          id: t.id, nom: t.nom, actif: t.actif,
          non_verse_cents: nonVerse, verse_cents: verse,
          demande_en_cours: enCoursSet.has(t.id),
          missions: missions.map(m => ({
            id: m.id, type: m.type, montant_cents: m.montant_du_cents || 0, paye: m.paye, fait_at: m.fait_at,
            client: [m.reservation?.prenom, m.reservation?.nom].filter(Boolean).join(' ') || null,
          })),
        };
      });
      return res.status(200).json({ transporteurs: result });
    }

    // Verser directement depuis l'admin, sans attendre que le livreur en fasse
    // la demande côté /transporteur — utile s'il ne pense pas à demander, ou
    // pour tout solder avant qu'il quitte l'équipe.
    if (action === 'verser_maintenant') {
      const transporteurId = parseInt(body.transporteur_id);
      if (!transporteurId || !transpIds.includes(transporteurId)) return res.status(404).json({ error: 'Transporteur introuvable' });

      const { data: faites } = await supabase
        .from('livraisons').select('id, montant_du_cents')
        .eq('transporteur_id', transporteurId).eq('statut', 'fait').eq('paye', false);
      const montant = (faites || []).reduce((s, f) => s + (f.montant_du_cents || 0), 0);
      if (montant <= 0) return res.status(400).json({ error: 'Rien à verser pour ce transporteur' });
      const ids = (faites || []).map(f => f.id);

      await supabase.from('livraisons').update({ paye: true }).in('id', ids);

      // Une demande de virement déjà en cours pour ce transporteur est réglée
      // par ce paiement plutôt que dupliquée avec une nouvelle ligne.
      const { data: existante } = await supabase
        .from('virements').select('id').eq('transporteur_id', transporteurId).eq('statut', 'demande').maybeSingle();
      if (existante) {
        await supabase.from('virements').update({ statut: 'verse', montant_cents: montant, verse_at: new Date().toISOString() }).eq('id', existante.id);
      } else {
        await supabase.from('virements').insert({
          transporteur_id: transporteurId, montant_cents: montant, statut: 'verse', verse_at: new Date().toISOString(),
        });
      }

      return res.status(200).json({ ok: true, montant_cents: montant });
    }

    if (action === 'marquer_verse') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });

      const { data: virement } = await supabase.from('virements').select('*').eq('id', id).in('transporteur_id', transpIds).maybeSingle();
      if (!virement) return res.status(404).json({ error: 'Virement introuvable' });
      if (virement.statut === 'verse') return res.status(409).json({ error: 'Déjà marqué comme versé' });

      // Recalcul du montant réel au moment du virement (peut différer de la demande
      // si d'autres missions ont été terminées entre-temps).
      const { data: faites } = await supabase
        .from('livraisons').select('id, montant_du_cents')
        .eq('transporteur_id', virement.transporteur_id).eq('statut', 'fait').eq('paye', false);
      const montant = (faites || []).reduce((s, f) => s + (f.montant_du_cents || 0), 0);
      const ids = (faites || []).map(f => f.id);

      if (ids.length) {
        await supabase.from('livraisons').update({ paye: true }).in('id', ids);
      }
      await supabase.from('virements').update({ statut: 'verse', montant_cents: montant, verse_at: new Date().toISOString() }).eq('id', id);

      return res.status(200).json({ ok: true, montant_cents: montant });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin virements]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
