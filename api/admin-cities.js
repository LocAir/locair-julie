const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');
const { geocodeAddress } = require('./_lib/geo');

// undefined = champ non fourni (ne pas toucher) ; '' ou null = revenir au
// barème par défaut ; nombre = tarif personnalisé en centimes.
function tarifCentsOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Math.round(parseFloat(v) * 100);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Gestion des villes/zones — une "ville" ici est une zone opérationnelle
// pouvant couvrir plusieurs communes (ex. Nice + Saint-Laurent-du-Var +
// Cagnes-sur-Mer), routées par code postal (voir api/_lib/city.js,
// resolveCityByAddress). Contrairement au reste de l'app, la création
// d'une ville n'était jusqu'ici possible que par SQL direct (événement rare
// à l'origine) — désormais gérée depuis l'admin, la croissance multi-ville
// étant amenée à devenir courante.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    if (action === 'list') {
      // Lecture seule, nécessaire à toute l'admin pour choisir la ville
      // affichée — accessible à tous les rôles, contrairement à la
      // modification des tarifs/zones ci-dessous (réservée aux réglages).
      const { data, error } = await supabase.from('cities').select('*').order('name');
      if (error) throw error;
      return res.status(200).json({ cities: data || [] });
    }
    if (!roleHasAccess(admin.role, 'reglages')) return res.status(403).json({ error: "Ton compte n'a pas accès aux réglages." });

    if (action === 'create') {
      const name = (body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Nom requis' });
      const slug = (body.slug || name).trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // accents -> lettres simples
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!slug) return res.status(400).json({ error: 'Slug invalide' });
      const postalCodes = Array.isArray(body.postal_codes)
        ? body.postal_codes.map(cp => String(cp).trim()).filter(Boolean)
        : [];
      const { error } = await supabase.from('cities').insert({
        slug, name,
        dep:          (body.dep || '').trim() || null,
        postal:       postalCodes[0] || null,
        postal_codes: postalCodes,
        actif:        true,
        tarif_livraison_autonome_cents:   tarifCentsOrNull(body.tarif_livraison_autonome),
        tarif_livraison_technicien_cents: tarifCentsOrNull(body.tarif_livraison_technicien),
        tarif_recuperation_cents:         tarifCentsOrNull(body.tarif_recuperation),
        tarif_changement_cents:           tarifCentsOrNull(body.tarif_changement),
      });
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Une ville avec ce slug existe déjà' });
        throw error;
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'update') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const patch = {};
      if (body.name != null)  patch.name  = body.name.trim();
      if (body.dep != null)   patch.dep   = body.dep.trim() || null;
      if (body.actif     != null) patch.actif     = Boolean(body.actif);
      // Mode "complet" : automatique par défaut (recalculé en base par les
      // triggers de migration_auto_sold_out.sql à partir du stock réel), ou
      // manuel si l'admin veut garder la main temporairement (incident,
      // contrôle qualité, fermeture volontaire).
      if (body.sold_out_mode != null) {
        const mode = String(body.sold_out_mode);
        if (!['auto', 'manuel'].includes(mode)) return res.status(400).json({ error: 'Mode invalide' });
        patch.sold_out_mode = mode;
      }
      // sold_out ne peut être forcé à la main que si la ville est (ou
      // devient, dans cette même requête) en mode "manuel" — sinon le
      // prochain mouvement de stock l'écraserait silencieusement.
      if (body.sold_out != null) {
        let mode = patch.sold_out_mode;
        if (!mode) {
          const { data: cur, error: curErr } = await supabase.from('cities').select('sold_out_mode').eq('id', id).maybeSingle();
          if (curErr) throw curErr;
          mode = cur?.sold_out_mode;
        }
        if (mode !== 'manuel') {
          return res.status(400).json({ error: 'Passe la ville en mode manuel avant de forcer "complet"' });
        }
        patch.sold_out = Boolean(body.sold_out);
      }
      if (Array.isArray(body.postal_codes)) {
        patch.postal_codes = body.postal_codes.map(cp => String(cp).trim()).filter(Boolean);
      }
      if (body.tarif_livraison_autonome != null)   patch.tarif_livraison_autonome_cents   = tarifCentsOrNull(body.tarif_livraison_autonome);
      if (body.tarif_livraison_technicien != null) patch.tarif_livraison_technicien_cents = tarifCentsOrNull(body.tarif_livraison_technicien);
      if (body.tarif_recuperation != null)         patch.tarif_recuperation_cents         = tarifCentsOrNull(body.tarif_recuperation);
      if (body.tarif_changement != null)           patch.tarif_changement_cents           = tarifCentsOrNull(body.tarif_changement);
      // Adresse du box (dépôt matériel) — géocodée une seule fois ici plutôt
      // qu'à chaque calcul de tournée transporteur (api/transporteur-route.js),
      // qui la relit telle quelle depuis la ville.
      if (body.depot_adresse != null) {
        const depotAdresse = body.depot_adresse.trim();
        patch.depot_adresse = depotAdresse || null;
        if (depotAdresse) {
          const geo = await geocodeAddress(depotAdresse);
          patch.depot_lat = geo ? geo.lat : null;
          patch.depot_lng = geo ? geo.lng : null;
          if (!geo) console.error('[Admin cities] Géocodage échoué pour l\'adresse du box:', depotAdresse);
        } else {
          patch.depot_lat = null;
          patch.depot_lng = null;
        }
      }
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Rien à modifier' });
      const { error } = await supabase.from('cities').update(patch).eq('id', id);
      if (error) throw error;
      // En repassant en automatique, resynchroniser tout de suite avec le
      // vrai stock plutôt que d'attendre le prochain mouvement.
      if (patch.sold_out_mode === 'auto') {
        const { error: rpcErr } = await supabase.rpc('_auto_sold_out', { p_city_id: id });
        if (rpcErr) console.error('[Admin cities] _auto_sold_out failed:', rpcErr.message);
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin cities]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
