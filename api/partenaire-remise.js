// Remise ET retour d'un appareil Click & Collect, confirmés par le commerçant
// partenaire.
// Le client montre son QR code (envoyé par email et affiché après paiement) ;
// le commerçant le scanne avec l'appareil photo de son téléphone, ce qui
// ouvre son espace partenaire (/partenaire?remise=<id>.<code>). Il voit la
// réservation, vérifie la pièce d'identité et confirme la remise. Au retour,
// même QR code, même page : il confirme le retour de l'appareil.
//
// Actions :
//   'voir'    afficher la réservation (+ ce qu'on peut faire maintenant)
//   'valider' enregistrer la remise au client (remis_at)
//   'rendre'  enregistrer le retour de l'appareil (rendu_at, statut 'terminee')
// Jeton partenaire obligatoire (même connexion que l'espace partenaire).
// Seul le commerçant de CE point peut agir : reservations.partenaire_id, ou,
// si la réservation n'a pas de partenaire, le code partenaire du point
// (pointsRetrait.js → partenaire_code).
//
// Colonnes rendu_at / rendu_par_partenaire_id : ajoutées par
// supabase/migration_2026-11-19_click_collect_retour.sql. Tant qu'elles
// n'existent pas, 'rendre' répond un message clair au lieu de planter.
const { getSupabase } = require('./_lib/supabase');
const { verifyPartenaireToken, safeEqual } = require('./_lib/auth');
const { codeRemise } = require('./_lib/clickCollect');
const { agir, estLeBonCommercant } = require('./_lib/remiseCC');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const partenaireId = await verifyPartenaireToken(req, supabase);
  if (!partenaireId) return res.status(401).json({ error: 'Connectez-vous à votre espace partenaire.' });

  const b = req.body || {};
  const [idTxt, code] = String(b.code || '').split('.');
  const id = parseInt(idTxt, 10);
  if (!id || !code) return res.status(400).json({ error: 'QR code illisible.' });

  try {
    const { data: r } = await supabase.from('reservations').select('*').eq('id', id).maybeSingle();
    if (!r || r.source_channel !== 'click_collect' || !safeEqual(code, codeRemise(r.id, r.ref))) {
      return res.status(404).json({ error: 'QR code inconnu. Demandez au client son email de confirmation.' });
    }
    if (!(await estLeBonCommercant(supabase, r, partenaireId))) {
      return res.status(403).json({ error: 'Cette réservation est prévue dans un autre point de retrait.' });
    }
    const out = await agir(supabase, r, partenaireId, b.action || 'voir');
    return res.status(out.status).json(out.body);
  } catch (err) {
    console.error('[partenaire-remise]', err.message);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};
