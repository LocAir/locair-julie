const { getSupabase } = require('./_lib/supabase');
const { checkAdminToken } = require('./_lib/auth');

// Pas de rattachement par ville ici, contrairement à admin-virements.js — un
// partenaire (conciergerie...) n'est pas une ressource opérationnelle
// localisée, il peut apporter des clients quelle que soit la ville.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    if (action === 'list') {
      const { data, error } = await supabase
        .from('partenaire_virements')
        .select('id, montant_cents, statut, created_at, verse_at, partenaire:partenaires ( id, nom )')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return res.status(200).json({ virements: data || [] });
    }

    // Vue "revenus par partenaire" : toutes les réservations confirmées
    // apportées par chaque partenaire, commission versée ou non, avec le
    // détail réservation par réservation.
    if (action === 'summary') {
      const { data: partenaires } = await supabase
        .from('partenaires').select('id, nom, code, actif').order('nom');
      const ids = (partenaires || []).map(p => p.id);
      if (!ids.length) return res.status(200).json({ partenaires: [] });

      const { data: resas } = await supabase
        .from('reservations')
        .select('id, partenaire_id, ref, prenom, nom, prix_total_cents, partenaire_commission_cents, partenaire_commission_payee, created_at')
        .in('partenaire_id', ids).eq('statut', 'confirmee').eq('masquee', false)
        .order('created_at', { ascending: false });

      const { data: demandesEnCours } = await supabase
        .from('partenaire_virements').select('partenaire_id').in('partenaire_id', ids).eq('statut', 'demande');
      const enCoursSet = new Set((demandesEnCours || []).map(v => v.partenaire_id));

      const byPartenaire = {};
      (resas || []).forEach(r => { (byPartenaire[r.partenaire_id] = byPartenaire[r.partenaire_id] || []).push(r); });

      const result = (partenaires || []).map(p => {
        const reservations = byPartenaire[p.id] || [];
        const nonVerse = reservations.filter(r => !r.partenaire_commission_payee).reduce((s, r) => s + (r.partenaire_commission_cents || 0), 0);
        const verse    = reservations.filter(r => r.partenaire_commission_payee).reduce((s, r) => s + (r.partenaire_commission_cents || 0), 0);
        return {
          id: p.id, nom: p.nom, code: p.code, actif: p.actif,
          non_verse_cents: nonVerse, verse_cents: verse,
          demande_en_cours: enCoursSet.has(p.id),
          reservations: reservations.map(r => ({
            id: r.id, ref: r.ref,
            client: [r.prenom, r.nom].filter(Boolean).join(' ') || null,
            montant_cents: r.prix_total_cents || 0,
            commission_cents: r.partenaire_commission_cents || 0,
            payee: r.partenaire_commission_payee,
            created_at: r.created_at,
          })),
        };
      });
      return res.status(200).json({ partenaires: result });
    }

    // Verser directement depuis l'admin, sans attendre que le partenaire en
    // fasse la demande.
    if (action === 'verser_maintenant') {
      const partenaireId = parseInt(body.partenaire_id);
      if (!partenaireId) return res.status(400).json({ error: 'partenaire_id manquant' });

      const { data: resas } = await supabase
        .from('reservations').select('id, partenaire_commission_cents')
        .eq('partenaire_id', partenaireId).eq('statut', 'confirmee').eq('masquee', false)
        .eq('partenaire_commission_payee', false);
      const montant = (resas || []).reduce((s, r) => s + (r.partenaire_commission_cents || 0), 0);
      if (montant <= 0) return res.status(400).json({ error: 'Rien à verser pour ce partenaire' });
      const ids = (resas || []).map(r => r.id);

      await supabase.from('reservations').update({ partenaire_commission_payee: true }).in('id', ids);

      const { data: existante } = await supabase
        .from('partenaire_virements').select('id').eq('partenaire_id', partenaireId).eq('statut', 'demande').maybeSingle();
      if (existante) {
        await supabase.from('partenaire_virements').update({ statut: 'verse', montant_cents: montant, verse_at: new Date().toISOString() }).eq('id', existante.id);
      } else {
        await supabase.from('partenaire_virements').insert({
          partenaire_id: partenaireId, montant_cents: montant, statut: 'verse', verse_at: new Date().toISOString(),
        });
      }

      return res.status(200).json({ ok: true, montant_cents: montant });
    }

    if (action === 'marquer_verse') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });

      const { data: virement } = await supabase.from('partenaire_virements').select('*').eq('id', id).maybeSingle();
      if (!virement) return res.status(404).json({ error: 'Virement introuvable' });
      if (virement.statut === 'verse') return res.status(409).json({ error: 'Déjà marqué comme versé' });

      // Recalcul du montant réel au moment du virement (peut différer de la
      // demande si d'autres réservations ont été confirmées entre-temps).
      const { data: resas } = await supabase
        .from('reservations').select('id, partenaire_commission_cents')
        .eq('partenaire_id', virement.partenaire_id).eq('statut', 'confirmee').eq('masquee', false)
        .eq('partenaire_commission_payee', false);
      const montant = (resas || []).reduce((s, r) => s + (r.partenaire_commission_cents || 0), 0);
      const ids = (resas || []).map(r => r.id);

      if (ids.length) {
        await supabase.from('reservations').update({ partenaire_commission_payee: true }).in('id', ids);
      }
      await supabase.from('partenaire_virements').update({ statut: 'verse', montant_cents: montant, verse_at: new Date().toISOString() }).eq('id', id);

      return res.status(200).json({ ok: true, montant_cents: montant });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin partenaire virements]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
