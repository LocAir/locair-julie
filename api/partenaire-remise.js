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
const { getPointRetrait } = require('./_lib/pointsRetrait');
const { todayParis, addDays } = require('./_lib/dates');
const { pushToAdmin } = require('./_lib/push');

const MSG_MAJ = 'Action impossible pour le moment (mise à jour du système en cours). Appelez Loc’Air : 06 63 79 87 56.';

// Erreur Postgres « la colonne n'existe pas » (migration pas encore passée).
function colonneManquante(error, motif) {
  if (!error) return false;
  return error.code === '42703' || (motif ? motif.test(error.message || '') : /does not exist/i.test(error.message || ''));
}

function dateFrCourte(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Ce partenaire est-il bien le commerçant du point de cette réservation ?
async function estLeBonCommercant(supabase, r, partenaireId) {
  if (r.partenaire_id) return r.partenaire_id === partenaireId;
  const point = getPointRetrait(r.point_retrait_id || '');
  if (!point || !point.partenaire_code) return false;
  const { data: p } = await supabase.from('partenaires').select('code').eq('id', partenaireId).maybeSingle();
  return !!p && String(p.code || '').toLowerCase() === String(point.partenaire_code).toLowerCase();
}

// Ce qu'on peut faire aujourd'hui (heure de Paris) avec cette réservation.
function etat(r, aujourdhui) {
  const rendu = !!r.rendu_at || r.statut === 'terminee';
  const ouvertureRemise = addDays(r.date_debut, -1);
  let remiseMessage = '';
  if (!r.remis_at && !rendu) {
    if (aujourdhui < ouvertureRemise) remiseMessage = `Trop tôt : le retrait est prévu le ${dateFrCourte(r.date_debut)}. La remise est possible au plus tôt la veille (${dateFrCourte(ouvertureRemise)}).`;
    else if (aujourdhui > r.date_fin) remiseMessage = `Trop tard : la location s’est terminée le ${dateFrCourte(r.date_fin)}. Appelez Loc’Air : 06 63 79 87 56.`;
  }
  return {
    rendu,
    peut_remettre: !r.remis_at && !rendu && !remiseMessage,
    remise_message: remiseMessage,
    // Retour : une fois l'appareil sorti (remise confirmée), ou à partir du
    // jour du retrait si le commerçant a oublié de confirmer la remise.
    peut_rendre: !rendu && (!!r.remis_at || aujourdhui >= r.date_debut),
  };
}

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
    if (r.statut === 'en_attente') return res.status(409).json({ error: 'Le paiement de cette réservation n’est pas encore confirmé. Ne remettez pas l’appareil.' });
    if (r.statut === 'annulee' || r.statut === 'remboursee') return res.status(409).json({ error: 'Cette réservation est annulée ou remboursée. Ne remettez pas l’appareil.' });
    if (r.statut !== 'confirmee' && r.statut !== 'terminee') return res.status(409).json({ error: 'Cette réservation n’est pas active. Appelez Loc’Air : 06 63 79 87 56.' });

    // Fin réelle de la location : la date de la réservation d'origine est
    // mise à jour à chaque prolongation payée (webhook.js).
    const aujourdhui = todayParis();
    const e = etat(r, aujourdhui);
    const fiche = {
      ref: r.ref, prenom: r.prenom, nom: r.nom,
      date_debut: r.date_debut, date_fin: r.date_fin,
      point: String(r.adresse || '').replace(/^CLICK & COLLECT — /, ''),
      remis_at: r.remis_at || null,
      rendu_at: r.rendu_at || null,
      // La photo de la pièce n'est jamais envoyée au commerçant : seulement
      // l'information « reçue en ligne ou non », pour qu'il sache quoi vérifier.
      piece_recue: Array.isArray(r.piece_identite_paths) ? r.piece_identite_paths.length > 0 : /identites\//.test(r.instructions_acces || ''),
      ...e,
      // false = colonne rendu_at absente en base (migration à passer) :
      // la page n'affiche pas le bouton « Confirmer le retour ».
      retour_disponible: 'rendu_at' in r,
      en_retard: !e.rendu && !!r.remis_at && aujourdhui > r.date_fin,
    };
    const action = b.action || 'voir';
    if (action === 'voir') return res.status(200).json({ reservation: fiche });

    if (action === 'valider') {
      if (r.remis_at) return res.status(200).json({ ok: true, deja: true, reservation: fiche });
      if (e.rendu) return res.status(409).json({ error: 'Cet appareil a déjà été rendu : la location est terminée.' });
      if (!e.peut_remettre) return res.status(409).json({ error: e.remise_message || 'Remise impossible aujourd’hui.' });
      const maintenant = new Date().toISOString();
      const { error } = await supabase.from('reservations')
        .update({ remis_at: maintenant, remis_par_partenaire_id: partenaireId }).eq('id', r.id).is('remis_at', null);
      if (error) {
        console.error('[partenaire-remise]', error.message);
        return res.status(500).json({ error: colonneManquante(error, /remis_at|remis_par/) ? MSG_MAJ : 'Erreur serveur.' });
      }
      pushToAdmin(supabase, {
        title: 'Click & Collect — appareil remis',
        body: `${r.ref} — ${r.prenom || ''} ${r.nom || ''} — ${fiche.point}`.trim(),
        type: 'info', tag: `remise-${r.id}`,
      }).catch(() => {});
      return res.status(200).json({ ok: true, reservation: { ...fiche, remis_at: maintenant, peut_remettre: false, peut_rendre: fiche.retour_disponible } });
    }

    if (action === 'rendre') {
      if (!fiche.retour_disponible) return res.status(503).json({ error: MSG_MAJ });
      if (e.rendu) return res.status(200).json({ ok: true, deja: true, reservation: fiche });
      if (!e.peut_rendre) return res.status(409).json({ error: `Le retrait est prévu le ${dateFrCourte(r.date_debut)} : l’appareil n’est pas encore parti.` });
      const maintenant = new Date().toISOString();
      const { data: maj, error } = await supabase.from('reservations')
        .update({ rendu_at: maintenant, rendu_par_partenaire_id: partenaireId, statut: 'terminee' })
        .eq('id', r.id).is('rendu_at', null).select('id');
      if (error) {
        console.error('[partenaire-remise rendre]', error.message);
        return res.status(colonneManquante(error, /rendu_at|rendu_par/) ? 503 : 500).json({ error: colonneManquante(error, /rendu_at|rendu_par/) ? MSG_MAJ : 'Erreur serveur.' });
      }
      if (!maj || !maj.length) return res.status(200).json({ ok: true, deja: true, reservation: fiche });
      // Les prolongations de cette location sont terminées elles aussi
      // (même appareil, même point). Erreur ignorée : la ligne principale
      // est déjà à jour, c'est elle qui compte pour les alertes.
      await supabase.from('reservations')
        .update({ rendu_at: maintenant, rendu_par_partenaire_id: partenaireId, statut: 'terminee' })
        .eq('reservation_origine_id', r.id).eq('statut', 'confirmee')
        .then(() => {}, (er) => console.error('[partenaire-remise prolongations]', er.message));
      const retard = aujourdhui > r.date_fin;
      pushToAdmin(supabase, {
        title: retard ? 'Click & Collect — appareil rendu en retard' : 'Click & Collect — appareil rendu',
        body: `${r.ref} — ${r.prenom || ''} ${r.nom || ''} — ${fiche.point}${retard ? ` (retour prévu le ${dateFrCourte(r.date_fin)})` : ''}`.trim(),
        type: 'info', tag: `rendu-${r.id}`,
      }).catch(() => {});
      return res.status(200).json({ ok: true, reservation: { ...fiche, rendu_at: maintenant, rendu: true, peut_rendre: false, peut_remettre: false, en_retard: false } });
    }

    return res.status(400).json({ error: 'Action inconnue.' });
  } catch (err) {
    console.error('[partenaire-remise]', err.message);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};
