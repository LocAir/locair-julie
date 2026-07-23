const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');

// Pas de rattachement par ville ici, contrairement à admin-virements.js — un
// partenaire (conciergerie...) n'est pas une ressource opérationnelle
// localisée, il peut apporter des clients quelle que soit la ville.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });
  if (!roleHasAccess(admin.role, 'finances')) return res.status(403).json({ error: "Ton compte n'a pas accès aux commissions partenaires." });

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
        .from('partenaires').select('id, nom, code, actif, titulaire_compte, iban, bic').order('nom');
      const ids = (partenaires || []).map(p => p.id);
      if (!ids.length) return res.status(200).json({ partenaires: [] });

      // 'confirmee' OU 'terminee' — une réservation passe à 'terminee' dès la
      // récupération effectuée (voir transporteur-action.js/admin-livraisons.js),
      // ce qui arrive pour toute location qui va à son terme normalement. En ne
      // gardant que 'confirmee' ici, la commission d'un partenaire disparaissait
      // purement et simplement (plus visible, plus payable) dès qu'une location
      // qu'il avait apportée se terminait sans que le virement ait été fait
      // avant — même logique déjà suivie par emailSchedule.js pour cette raison.
      const { data: resas } = await supabase
        .from('reservations')
        .select('id, partenaire_id, ref, prenom, nom, prix_total_cents, partenaire_commission_cents, partenaire_commission_payee, created_at')
        .in('partenaire_id', ids).in('statut', ['confirmee', 'terminee']).eq('masquee', false)
        .order('created_at', { ascending: false });

      const { data: virements } = await supabase
        .from('partenaire_virements')
        .select('id, partenaire_id, montant_cents, statut, facture_recue, created_at, verse_at')
        .in('partenaire_id', ids).eq('statut', 'demande')
        .order('created_at', { ascending: false });
      const enCoursSet = new Set((virements || []).map(v => v.partenaire_id));

      // Historique des virements déjà versés — pour le pense-bête "facture
      // reçue" (voir migration_partenaires_facture.sql), affiché par partenaire.
      const { data: virementsVerses } = await supabase
        .from('partenaire_virements')
        .select('id, partenaire_id, montant_cents, statut, facture_recue, created_at, verse_at')
        .in('partenaire_id', ids).eq('statut', 'verse')
        .order('verse_at', { ascending: false })
        .limit(200);
      const virementsByPartenaire = {};
      (virementsVerses || []).forEach(v => { (virementsByPartenaire[v.partenaire_id] = virementsByPartenaire[v.partenaire_id] || []).push(v); });

      // Réconciliation : réservation dont la commission était déjà versée au
      // partenaire, mais qui a ensuite été annulée ou remboursée — l'argent
      // est sorti pour un service qui n'a finalement pas eu lieu. Signalé
      // jusqu'à ce que l'admin marque le litige réglé (voir migration_partenaires_litiges.sql).
      const { data: litigesResas } = await supabase
        .from('reservations')
        .select('id, partenaire_id, ref, prenom, nom, statut, partenaire_commission_cents, created_at')
        .in('partenaire_id', ids).in('statut', ['annulee', 'remboursee'])
        .eq('partenaire_commission_payee', true).eq('partenaire_litige_resolu', false).eq('masquee', false)
        .order('created_at', { ascending: false });
      const litigesByPartenaire = {};
      (litigesResas || []).forEach(r => { (litigesByPartenaire[r.partenaire_id] = litigesByPartenaire[r.partenaire_id] || []).push(r); });

      const byPartenaire = {};
      (resas || []).forEach(r => { (byPartenaire[r.partenaire_id] = byPartenaire[r.partenaire_id] || []).push(r); });

      const result = (partenaires || []).map(p => {
        const reservations = byPartenaire[p.id] || [];
        const nonVerse = reservations.filter(r => !r.partenaire_commission_payee).reduce((s, r) => s + (r.partenaire_commission_cents || 0), 0);
        const verse    = reservations.filter(r => r.partenaire_commission_payee).reduce((s, r) => s + (r.partenaire_commission_cents || 0), 0);
        const litiges  = litigesByPartenaire[p.id] || [];
        return {
          id: p.id, nom: p.nom, code: p.code, actif: p.actif,
          titulaire_compte: p.titulaire_compte, iban: p.iban, bic: p.bic,
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
          virements: (virementsByPartenaire[p.id] || []).map(v => ({
            id: v.id, montant_cents: v.montant_cents, verse_at: v.verse_at, facture_recue: v.facture_recue,
          })),
          a_recuperer_cents: litiges.reduce((s, r) => s + (r.partenaire_commission_cents || 0), 0),
          litiges: litiges.map(r => ({
            id: r.id, ref: r.ref, statut: r.statut,
            client: [r.prenom, r.nom].filter(Boolean).join(' ') || null,
            commission_cents: r.partenaire_commission_cents || 0,
            created_at: r.created_at,
          })),
        };
      });
      return res.status(200).json({ partenaires: result });
    }

    // Marque un litige de réconciliation comme réglé (récupéré auprès du
    // partenaire, ou déduit du prochain virement) — ne retouche jamais
    // l'argent déjà versé, juste ce repère.
    if (action === 'resoudre_litige') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { error } = await supabase.from('reservations').update({ partenaire_litige_resolu: true })
        .eq('id', id).not('partenaire_id', 'is', null).eq('partenaire_commission_payee', true).eq('partenaire_litige_resolu', false);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // Pense-bête "facture reçue" (voir migration_partenaires_facture.sql) —
    // ne modifie jamais le montant ni le statut du virement, juste ce repère.
    if (action === 'toggle_facture') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { data: v } = await supabase.from('partenaire_virements').select('id, facture_recue').eq('id', id).maybeSingle();
      if (!v) return res.status(404).json({ error: 'Virement introuvable' });
      const nextValue = !v.facture_recue;
      const { error } = await supabase.from('partenaire_virements').update({ facture_recue: nextValue }).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true, facture_recue: nextValue });
    }

    // Verser directement depuis l'admin, sans attendre que le partenaire en
    // fasse la demande.
    if (action === 'verser_maintenant') {
      const partenaireId = parseInt(body.partenaire_id);
      if (!partenaireId) return res.status(400).json({ error: 'partenaire_id manquant' });

      const { data: resas } = await supabase
        .from('reservations').select('id, partenaire_commission_cents')
        .eq('partenaire_id', partenaireId).in('statut', ['confirmee', 'terminee']).eq('masquee', false)
        .eq('partenaire_commission_payee', false);
      const montant = (resas || []).reduce((s, r) => s + (r.partenaire_commission_cents || 0), 0);
      const ids = (resas || []).map(r => r.id);

      // Une demande de virement déjà en cours pour ce partenaire est réglée
      // par ce paiement plutôt que dupliquée avec une nouvelle ligne.
      const { data: existante } = await supabase
        .from('partenaire_virements').select('id').eq('partenaire_id', partenaireId).eq('statut', 'demande').maybeSingle();

      // Rien à verser ET aucune demande à régler : vraiment rien à faire. Mais
      // s'il y a une demande en cours pour 0 € (commissions déjà réglées par
      // ailleurs entre-temps), on la solde quand même — sinon le badge
      // "virement demandé" reste bloqué pour toujours (même bug que côté
      // transporteurs).
      if (montant <= 0 && !existante) {
        return res.status(400).json({ error: 'Rien à verser pour ce partenaire' });
      }

      if (ids.length) await supabase.from('reservations').update({ partenaire_commission_payee: true }).in('id', ids);

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
        .eq('partenaire_id', virement.partenaire_id).in('statut', ['confirmee', 'terminee']).eq('masquee', false)
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
