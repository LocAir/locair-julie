const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity } = require('./_lib/city');
const { checkAdminToken } = require('./_lib/auth');

// Remplace entièrement les zones d'intervention et/ou les disponibilités
// d'un transporteur (delete + insert) — plus simple et plus sûr qu'un diff
// fin vu le faible volume de lignes concernées (quelques zones, quelques
// jours). `villes`/`disponibilites` restent inchangées si non fournies
// (undefined), pour ne pas écraser l'existant sur un update partiel.
async function replaceVilles(supabase, transporteurId, villes) {
  if (villes === undefined) return;
  await supabase.from('transporteur_villes').delete().eq('transporteur_id', transporteurId);
  const ids = [...new Set((villes || []).map(v => parseInt(v)).filter(Boolean))];
  if (ids.length) {
    await supabase.from('transporteur_villes')
      .insert(ids.map(city_id => ({ transporteur_id: transporteurId, city_id })));
  }
}
async function replaceDisponibilites(supabase, transporteurId, disponibilites) {
  if (disponibilites === undefined) return;
  await supabase.from('transporteur_disponibilites').delete().eq('transporteur_id', transporteurId);
  const rows = (disponibilites || [])
    .filter(d => d && Number.isInteger(d.jour) && d.jour >= 0 && d.jour <= 6 && ['matin', 'apres_midi', 'journee'].includes(d.moment))
    .map(d => ({ transporteur_id: transporteurId, jour: d.jour, moment: d.moment }));
  if (rows.length) {
    await supabase.from('transporteur_disponibilites').insert(rows);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    const city = await resolveAdminCity(supabase, body);
    if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });

    if (action === 'list') {
      const { data, error } = await supabase.from('transporteurs').select('*').eq('city_id', city.id).order('nom');
      if (error) throw error;
      const transporteurs = data || [];
      const ids = transporteurs.map(t => t.id);

      // Zones d'intervention + disponibilités — chargées à part et recollées
      // ici plutôt que via un join imbriqué, pour rester lisible côté client.
      const [{ data: villesRows }, { data: dispoRows }] = ids.length
        ? await Promise.all([
            supabase.from('transporteur_villes').select('transporteur_id, city_id').in('transporteur_id', ids),
            supabase.from('transporteur_disponibilites').select('transporteur_id, jour, moment').in('transporteur_id', ids),
          ])
        : [{ data: [] }, { data: [] }];

      const villesByT = {}; (villesRows || []).forEach(v => (villesByT[v.transporteur_id] = villesByT[v.transporteur_id] || []).push(v.city_id));
      const dispoByT   = {}; (dispoRows   || []).forEach(d => (dispoByT[d.transporteur_id]  = dispoByT[d.transporteur_id]  || []).push({ jour: d.jour, moment: d.moment }));

      return res.status(200).json({
        transporteurs: transporteurs.map(t => ({
          ...t,
          villes:         villesByT[t.id] || [],
          disponibilites: dispoByT[t.id]  || [],
        })),
      });
    }

    if (action === 'create') {
      const nom = (body.nom || '').trim();
      if (!nom) return res.status(400).json({ error: 'Nom requis' });

      // Zones d'intervention par défaut : la ville actuellement sélectionnée
      // dans l'admin, sauf sélection explicite d'une ou plusieurs zones.
      const villes = Array.isArray(body.villes) && body.villes.length ? body.villes : [city.id];

      // Code personnel à 6 chiffres — généré automatiquement si non fourni.
      let pin = (body.pin || '').trim();
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = pin || String(Math.floor(100000 + Math.random() * 900000));
        const typesAutorises = Array.isArray(body.types_autorises) ? body.types_autorises : [];
        const { data: created, error } = await supabase.from('transporteurs').insert({
          city_id:                 city.id,
          nom,
          telephone:               (body.telephone || '').trim() || null,
          email:                   (body.email || '').trim().toLowerCase() || null,
          pin:                     candidate,
          taux_livraison_cents:    Math.max(0, parseInt(body.taux_livraison_cents)    || 0),
          taux_recuperation_cents: Math.max(0, parseInt(body.taux_recuperation_cents) || 0),
          types_autorises:         typesAutorises,
        }).select('id').single();
        if (!error) {
          await replaceVilles(supabase, created.id, villes);
          await replaceDisponibilites(supabase, created.id, body.disponibilites);
          return res.status(200).json({ ok: true, pin: candidate });
        }
        if (pin || error.code !== '23505') throw error; // pin fourni par l'admin ou autre erreur : ne pas boucler
      }
      return res.status(500).json({ error: 'Impossible de générer un code unique, réessaie' });
    }

    if (action === 'update') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const patch = {};
      if (body.nom != null)       patch.nom       = body.nom.trim();
      if (body.telephone != null) patch.telephone = body.telephone.trim() || null;
      if (body.email != null)     patch.email     = body.email.trim().toLowerCase() || null;
      if (body.actif != null)     patch.actif     = Boolean(body.actif);
      if (body.en_pause != null)  patch.en_pause  = Boolean(body.en_pause);
      if (body.pin != null && body.pin.trim())  patch.pin = body.pin.trim();
      if (body.taux_livraison_cents != null)    patch.taux_livraison_cents    = Math.max(0, parseInt(body.taux_livraison_cents)    || 0);
      if (body.taux_recuperation_cents != null) patch.taux_recuperation_cents = Math.max(0, parseInt(body.taux_recuperation_cents) || 0);
      if (body.types_autorises !== undefined)   patch.types_autorises = Array.isArray(body.types_autorises) ? body.types_autorises : [];
      const hasFieldPatch = Object.keys(patch).length > 0;
      const hasVillesPatch = body.villes !== undefined || body.disponibilites !== undefined;
      if (!hasFieldPatch && !hasVillesPatch) return res.status(400).json({ error: 'Rien à modifier' });

      if (hasFieldPatch) {
        const { error } = await supabase.from('transporteurs').update(patch).eq('id', id).eq('city_id', city.id);
        if (error) {
          if (error.code === '23505') return res.status(409).json({ error: 'Ce code est déjà utilisé par un autre transporteur, réessaie' });
          throw error;
        }
      } else {
        // Vérifie quand même l'appartenance à la ville avant de toucher aux
        // zones/disponibilités, même sans modification des champs directs.
        const { data: owned } = await supabase.from('transporteurs').select('id').eq('id', id).eq('city_id', city.id).maybeSingle();
        if (!owned) return res.status(404).json({ error: 'Transporteur introuvable' });
      }
      // Changer le code déconnecte aussi tout accès biométrique déjà enregistré
      // (même logique que pour les jetons de session) — le transporteur devra le
      // réactiver avec son nouveau code.
      if (patch.pin) {
        await supabase.from('webauthn_credentials').delete().eq('transporteur_id', id);
      }
      await replaceVilles(supabase, id, body.villes);
      await replaceDisponibilites(supabase, id, body.disponibilites);
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { data: owned } = await supabase.from('transporteurs').select('id').eq('id', id).eq('city_id', city.id).maybeSingle();
      if (!owned) return res.status(404).json({ error: 'Transporteur introuvable' });

      const { error } = await supabase.from('transporteurs').delete().eq('id', id);
      if (error) {
        // Contrainte de clé étrangère (missions/virements liés) : un transporteur
        // avec un historique réel ne doit jamais disparaître silencieusement
        // (perte de traçabilité des paiements) — on le désactive à la place.
        if (error.code === '23503') {
          await supabase.from('transporteurs').update({ actif: false }).eq('id', id);
          return res.status(200).json({ ok: true, deactivated: true, error: 'Ce transporteur a des missions ou virements liés — il a été désactivé plutôt que supprimé, pour garder l\'historique.' });
        }
        throw error;
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin transporteurs]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
