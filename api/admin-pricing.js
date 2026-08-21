const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');
const { DEFAULT_PRICING_CONFIG } = require('./_lib/pricing');

// Panneau de contrôle des tarifs de location — source unique lue par
// api/_lib/pricing.js (calcul du prix réel à chaque paiement/prolongation/
// facturation de retard) ET par le site public, la facture, le contrat, les
// CGV, la page retard (voir /api/pricing-config, lecture publique). Avant
// ça, changer un tarif voulait dire retrouver et corriger ~37 endroits à la
// main dans le code — un seul oublié affichait un prix qui ne correspondait
// plus à ce qui était réellement facturé.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'get';

  try {
    if (action === 'get') {
      // Lecture accessible à tout compte connecté (comme les villes) — seule
      // la modification est réservée aux comptes ayant accès aux réglages.
      const { data, error } = await supabase.from('pricing_config').select('*').eq('id', 1).maybeSingle();
      if (error) throw error;
      return res.status(200).json({ pricing: data || DEFAULT_PRICING_CONFIG });
    }

    if (!roleHasAccess(admin.role, 'reglages')) return res.status(403).json({ error: "Ton compte n'a pas accès aux réglages." });

    if (action === 'update') {
      const toInt = (v) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : null;
      };
      const toCents = (v) => {
        const n = Math.round(parseFloat(v) * 100);
        return Number.isFinite(n) ? n : null;
      };

      const dureeMin  = toInt(body.duree_min_jours);
      const p1Max     = toInt(body.palier1_max_jours);
      const p1Cents   = toCents(body.palier1_tarif);
      const p2Max     = toInt(body.palier2_max_jours);
      const p2Cents   = toCents(body.palier2_tarif);
      const p3Max     = toInt(body.palier3_max_jours);
      const p3Cents   = toCents(body.palier3_tarif);
      const p4Cents   = toCents(body.palier4_tarif);

      const values = [dureeMin, p1Max, p1Cents, p2Max, p2Cents, p3Max, p3Cents, p4Cents];
      if (values.some((v) => v === null || v < 0)) {
        return res.status(400).json({ error: 'Tous les champs sont requis et doivent être positifs.' });
      }
      // Mêmes garde-fous que la contrainte SQL (pricing_config_paliers_croissants)
      // — revérifiés ici pour renvoyer un message clair avant d'atteindre la base.
      if (!(p1Max < p2Max && p2Max < p3Max)) {
        return res.status(400).json({ error: 'Les paliers doivent être strictement croissants (ex. 7 puis 14 puis 21 jours).' });
      }
      if (dureeMin < 1 || dureeMin > p1Max) {
        return res.status(400).json({ error: 'La durée minimale doit être comprise entre 1 jour et la fin du 1er palier.' });
      }

      const maj = {
        duree_min_jours:     dureeMin,
        palier1_max_jours:   p1Max, palier1_tarif_cents: p1Cents,
        palier2_max_jours:   p2Max, palier2_tarif_cents: p2Cents,
        palier3_max_jours:   p3Max, palier3_tarif_cents: p3Cents,
        palier4_tarif_cents: p4Cents,
        updated_at: new Date().toISOString(),
      };

      // ── Grille pro (rafraîchisseurs) ────────────────────────────────────
      // Facultative et indépendante : ces champs ne sont écrits QUE si
      // l'admin les envoie. Un enregistrement fait depuis l'écran actuel,
      // qui ne les connaît pas, laisse donc la grille pro intacte au lieu
      // de l'effacer.
      const proChamps = {
        pro_duree_min_jours:     toInt(body.pro_duree_min_jours),
        pro_palier1_tarif_cents: toCents(body.pro_palier1_tarif),
        pro_palier2_tarif_cents: toCents(body.pro_palier2_tarif),
        pro_palier3_tarif_cents: toCents(body.pro_palier3_tarif),
        pro_palier4_tarif_cents: toCents(body.pro_palier4_tarif),
        pro_forfait_cents:       toCents(body.pro_forfait),
      };
      const proFournis = Object.entries(proChamps).filter(([, v]) => v !== null);
      if (proFournis.length) {
        if (proFournis.some(([, v]) => v < 0)) {
          return res.status(400).json({ error: 'Les tarifs pro doivent être positifs.' });
        }
        proFournis.forEach(([k, v]) => { maj[k] = v; });
      }

      const { error } = await supabase.from('pricing_config').update(maj).eq('id', 1);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin pricing]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
