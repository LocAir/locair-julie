const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity } = require('./_lib/city');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');
const { notifyTransporteur } = require('./_lib/transporteurNotif');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });
  if (!roleHasAccess(admin.role, 'finances')) return res.status(403).json({ error: "Ton compte n'a pas accès aux paiements transporteurs." });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    const city = await resolveAdminCity(supabase, body);
    if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });
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
          id, type, transporteur_id, montant_du_cents, paye, valide, fait_at,
          reservation:reservations ( prenom, nom, adresse )
        `)
        .in('transporteur_id', ids).eq('statut', 'fait')
        .order('fait_at', { ascending: false });

      const { data: demandesEnCours } = await supabase
        .from('virements').select('transporteur_id').in('transporteur_id', ids).eq('statut', 'demande');
      const enCoursSet = new Set((demandesEnCours || []).map(v => v.transporteur_id));

      const byTransp = {};
      (faites || []).forEach(f => { (byTransp[f.transporteur_id] = byTransp[f.transporteur_id] || []).push(f); });

      // 3 statuts (Partie 9) : en attente de validation humaine -> validé
      // (payable) -> payé. Seules les missions "validé" comptent pour le
      // montant réellement versable (voir verser_maintenant/marquer_verse).
      const result = (transporteurs || []).map(t => {
        const missions = byTransp[t.id] || [];
        const enAttenteValidation = missions.filter(m => !m.paye && !m.valide).reduce((s, m) => s + (m.montant_du_cents || 0), 0);
        const nonVerse = missions.filter(m => !m.paye && m.valide).reduce((s, m) => s + (m.montant_du_cents || 0), 0);
        const verse    = missions.filter(m => m.paye).reduce((s, m) => s + (m.montant_du_cents || 0), 0);
        return {
          id: t.id, nom: t.nom, actif: t.actif,
          en_attente_validation_cents: enAttenteValidation, non_verse_cents: nonVerse, verse_cents: verse,
          demande_en_cours: enCoursSet.has(t.id),
          missions: missions.map(m => ({
            id: m.id, type: m.type, montant_cents: m.montant_du_cents || 0,
            statut_paiement: m.paye ? 'paye' : (m.valide ? 'valide' : 'en_attente'),
            fait_at: m.fait_at,
            client: [m.reservation?.prenom, m.reservation?.nom].filter(Boolean).join(' ') || null,
          })),
        };
      });
      return res.status(200).json({ transporteurs: result });
    }

    // Correction manuelle d'un montant après coup (Module 9) — ex. mission mal
    // tarifée, oubli d'un supplément. Autorisée tant que ce n'est pas encore
    // versé (une fois payé, le montant réel du virement fait foi et ne doit
    // plus bouger silencieusement). montant_manuel évite qu'un recalcul
    // ultérieur écrase cette correction (voir transporteur-action.js).
    if (action === 'modifier_montant') {
      const livraisonId  = parseInt(body.livraison_id);
      const montantCents = parseInt(body.montant_cents);
      if (!livraisonId || !Number.isFinite(montantCents) || montantCents < 0) {
        return res.status(400).json({ error: 'Paramètres invalides' });
      }
      const { data: liv } = await supabase
        .from('livraisons').select('id, transporteur_id, statut, paye')
        .eq('id', livraisonId).maybeSingle();
      if (!liv || !transpIds.includes(liv.transporteur_id)) return res.status(404).json({ error: 'Mission introuvable' });
      if (liv.statut !== 'fait') return res.status(400).json({ error: 'Mission non terminée' });
      if (liv.paye) return res.status(400).json({ error: 'Déjà versé : montant non modifiable' });

      await supabase.from('livraisons').update({ montant_du_cents: montantCents, montant_manuel: true }).eq('id', livraisonId);
      return res.status(200).json({ ok: true, montant_cents: montantCents });
    }

    // Validation humaine obligatoire avant paiement (Partie 9) — valide
    // toutes les missions terminées et pas encore validées d'un transporteur.
    if (action === 'valider') {
      const transporteurId = parseInt(body.transporteur_id);
      if (!transporteurId || !transpIds.includes(transporteurId)) return res.status(404).json({ error: 'Transporteur introuvable' });

      const { data: aValider } = await supabase
        .from('livraisons').select('id')
        .eq('transporteur_id', transporteurId).eq('statut', 'fait').eq('valide', false);
      const ids = (aValider || []).map(l => l.id);
      if (!ids.length) return res.status(400).json({ error: 'Rien à valider pour ce transporteur' });

      await supabase.from('livraisons').update({ valide: true, valide_at: new Date().toISOString() }).in('id', ids);
      await notifyTransporteur(supabase, transporteurId, {
        type: 'validation', message: 'Votre mission a été validée.', tag: 'validation',
      });

      return res.status(200).json({ ok: true, missions_validees: ids.length });
    }

    // Verser directement depuis l'admin, sans attendre que le livreur en fasse
    // la demande côté /transporteur — utile s'il ne pense pas à demander, ou
    // pour tout solder avant qu'il quitte l'équipe.
    if (action === 'verser_maintenant') {
      const transporteurId = parseInt(body.transporteur_id);
      if (!transporteurId || !transpIds.includes(transporteurId)) return res.status(404).json({ error: 'Transporteur introuvable' });

      const { data: faites } = await supabase
        .from('livraisons').select('id, montant_du_cents')
        .eq('transporteur_id', transporteurId).eq('statut', 'fait').eq('paye', false).eq('valide', true);
      const montant = (faites || []).reduce((s, f) => s + (f.montant_du_cents || 0), 0);
      if (montant <= 0) return res.status(400).json({ error: 'Rien à verser pour ce transporteur (missions pas encore validées ?)' });
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
      await notifyTransporteur(supabase, transporteurId, {
        type: 'paiement', message: `Votre rémunération a été payée (${(montant / 100).toFixed(2)} €).`, tag: 'paiement',
      });

      return res.status(200).json({ ok: true, montant_cents: montant });
    }

    if (action === 'marquer_verse') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });

      const { data: virement } = await supabase.from('virements').select('*').eq('id', id).in('transporteur_id', transpIds).maybeSingle();
      if (!virement) return res.status(404).json({ error: 'Virement introuvable' });
      if (virement.statut === 'verse') return res.status(409).json({ error: 'Déjà marqué comme versé' });

      // Recalcul du montant réel au moment du virement (peut différer de la demande
      // si d'autres missions ont été terminées entre-temps). Seules les
      // missions validées par l'administration sont payables (Partie 9).
      const { data: faites } = await supabase
        .from('livraisons').select('id, montant_du_cents')
        .eq('transporteur_id', virement.transporteur_id).eq('statut', 'fait').eq('paye', false).eq('valide', true);
      const montant = (faites || []).reduce((s, f) => s + (f.montant_du_cents || 0), 0);
      const ids = (faites || []).map(f => f.id);

      if (ids.length) {
        await supabase.from('livraisons').update({ paye: true }).in('id', ids);
      }
      await supabase.from('virements').update({ statut: 'verse', montant_cents: montant, verse_at: new Date().toISOString() }).eq('id', id);
      await notifyTransporteur(supabase, virement.transporteur_id, {
        type: 'paiement', message: `Votre rémunération a été payée (${(montant / 100).toFixed(2)} €).`, tag: 'paiement',
      });

      return res.status(200).json({ ok: true, montant_cents: montant });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin virements]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
