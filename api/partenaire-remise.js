// Remise d'un appareil Click & Collect par le commerçant partenaire.
// Le client montre son QR code (envoyé par email et affiché après paiement) ;
// le commerçant le scanne avec l'appareil photo de son téléphone, ce qui
// ouvre son espace partenaire (/partenaire?remise=<id>.<code>). Il voit la
// réservation, vérifie la pièce d'identité et confirme la remise.
//
// Actions : 'voir' (afficher la réservation), 'valider' (enregistrer la
// remise). Jeton partenaire obligatoire (même connexion que l'espace
// partenaire). Une réservation ne peut être remise que par le commerçant
// de SON point (reservations.partenaire_id), une seule fois, et seulement
// si le paiement est confirmé.
const { getSupabase } = require('./_lib/supabase');
const { verifyPartenaireToken, safeEqual } = require('./_lib/auth');
const { codeRemise } = require('./_lib/clickCollect');
const { pushToAdmin } = require('./_lib/push');

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
    if (r.partenaire_id !== partenaireId) return res.status(403).json({ error: 'Cette réservation est prévue dans un autre point de retrait.' });
    if (r.statut !== 'confirmee' && r.statut !== 'terminee') {
      return res.status(409).json({ error: r.statut === 'en_attente' ? 'Le paiement de cette réservation n’est pas encore confirmé.' : 'Cette réservation est annulée ou remboursée.' });
    }

    const fiche = {
      ref: r.ref, prenom: r.prenom, nom: r.nom,
      date_debut: r.date_debut, date_fin: r.date_fin,
      point: String(r.adresse || '').replace(/^CLICK & COLLECT — /, ''),
      remis_at: r.remis_at || null,
    };
    if (b.action !== 'valider') return res.status(200).json({ reservation: fiche });

    if (r.remis_at) return res.status(200).json({ ok: true, deja: true, reservation: fiche });
    const maintenant = new Date().toISOString();
    const { error } = await supabase.from('reservations')
      .update({ remis_at: maintenant, remis_par_partenaire_id: partenaireId }).eq('id', r.id).is('remis_at', null);
    if (error) {
      console.error('[partenaire-remise]', error.message);
      return res.status(500).json({ error: /remis_at|remis_par/.test(error.message) ? 'Remise impossible pour le moment (mise à jour du système en cours). Appelez Loc’Air : 06 63 79 87 56.' : 'Erreur serveur.' });
    }
    pushToAdmin(supabase, {
      title: 'Click & Collect — appareil remis',
      body: `${r.ref} — ${r.prenom || ''} ${r.nom || ''} — ${fiche.point}`.trim(),
      type: 'info', tag: `remise-${r.id}`,
    }).catch(() => {});
    return res.status(200).json({ ok: true, reservation: { ...fiche, remis_at: maintenant } });
  } catch (e) {
    console.error('[partenaire-remise]', e.message);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};
