// Remise et retour d'un appareil Click & Collect : règles communes à
//   - api/partenaire-remise.js : le commerçant scanne le QR code du client ;
//   - api/cc-comptoir.js       : le client scanne le QR code collé au comptoir,
//     tape son numéro de commande ; au retrait il valide lui-même, au retour
//     il tape le code commerçant (voir clickCollect.codeRetour).
// agir(supabase, r, partenaireId, action) → { status, body }
//   action : 'voir' | 'valider' (remise) | 'rendre' (retour)
const { getPointRetrait } = require('./pointsRetrait');
const { todayParis, addDays } = require('./dates');
const { pushToAdmin } = require('./push');

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


function R(status, body) { return { status, body }; }

async function agir(supabase, r, partenaireId, action) {
    if (r.statut === 'en_attente') return R(409, { error: 'Le paiement de cette réservation n’est pas encore confirmé. Ne remettez pas l’appareil.' });
    if (r.statut === 'annulee' || r.statut === 'remboursee') return R(409, { error: 'Cette réservation est annulée ou remboursée. Ne remettez pas l’appareil.' });
    if (r.statut !== 'confirmee' && r.statut !== 'terminee') return R(409, { error: 'Cette réservation n’est pas active. Appelez Loc’Air : 06 63 79 87 56.' });

    // Fin réelle de la location : la date de la réservation d'origine est
    // mise à jour à chaque prolongation payée (webhook.js).
    const aujourdhui = todayParis();
    const e = etat(r, aujourdhui);
    const fiche = {
      ref: r.ref, prenom: r.prenom, nom: r.nom, quantite: Math.max(1, r.quantite || 1),
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
    
    if (action === 'voir') return R(200, { reservation: fiche });

    if (action === 'valider') {
      if (r.remis_at) return R(200, { ok: true, deja: true, reservation: fiche });
      if (e.rendu) return R(409, { error: 'Cet appareil a déjà été rendu : la location est terminée.' });
      if (!e.peut_remettre) return R(409, { error: e.remise_message || 'Remise impossible aujourd’hui.' });
      const maintenant = new Date().toISOString();
      const { error } = await supabase.from('reservations')
        .update({ remis_at: maintenant, remis_par_partenaire_id: partenaireId }).eq('id', r.id).is('remis_at', null);
      if (error) {
        console.error('[partenaire-remise]', error.message);
        return R(500, { error: colonneManquante(error, /remis_at|remis_par/) ? MSG_MAJ : 'Erreur serveur.' });
      }
      pushToAdmin(supabase, {
        title: 'Click & Collect — appareil remis',
        body: `${r.ref} — ${r.prenom || ''} ${r.nom || ''}${(r.quantite || 1) > 1 ? ` — × ${r.quantite} appareils` : ''} — ${fiche.point}`.trim(),
        type: 'info', tag: `remise-${r.id}`,
      }).catch(() => {});
      return R(200, { ok: true, reservation: { ...fiche, remis_at: maintenant, peut_remettre: false, peut_rendre: fiche.retour_disponible } });
    }

    if (action === 'rendre') {
      if (!fiche.retour_disponible) return R(503, { error: MSG_MAJ });
      if (e.rendu) return R(200, { ok: true, deja: true, reservation: fiche });
      if (!e.peut_rendre) return R(409, { error: `Le retrait est prévu le ${dateFrCourte(r.date_debut)} : l’appareil n’est pas encore parti.` });
      const maintenant = new Date().toISOString();
      const { data: maj, error } = await supabase.from('reservations')
        .update({ rendu_at: maintenant, rendu_par_partenaire_id: partenaireId, statut: 'terminee' })
        .eq('id', r.id).is('rendu_at', null).select('id');
      if (error) {
        console.error('[partenaire-remise rendre]', error.message);
        return R(colonneManquante(error, /rendu_at|rendu_par/) ? 503 : 500, { error: colonneManquante(error, /rendu_at|rendu_par/) ? MSG_MAJ : 'Erreur serveur.' });
      }
      if (!maj || !maj.length) return R(200, { ok: true, deja: true, reservation: fiche });
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
        body: `${r.ref} — ${r.prenom || ''} ${r.nom || ''}${(r.quantite || 1) > 1 ? ` — × ${r.quantite} appareils` : ''} — ${fiche.point}${retard ? ` (retour prévu le ${dateFrCourte(r.date_fin)})` : ''}`.trim(),
        type: 'info', tag: `rendu-${r.id}`,
      }).catch(() => {});
      return R(200, { ok: true, reservation: { ...fiche, rendu_at: maintenant, rendu: true, peut_rendre: false, peut_remettre: false, en_retard: false } });
    }

    return R(400, { error: 'Action inconnue.' });
}

module.exports = { agir, estLeBonCommercant, etat, dateFrCourte, colonneManquante, MSG_MAJ };
