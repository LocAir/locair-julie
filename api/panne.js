// Page /panne : le client déclare une panne depuis chez lui, sans appeler.
// Il s'identifie avec son numéro de commande + les 4 derniers chiffres de son
// téléphone (essais limités). La suite est décidée par _lib/panne.js (une
// seule règle pour tous les canaux) : échange au point Click & Collect (le
// plus proche pour un client livré), ou réapprovisionnement urgent du point.
// Jamais de transporteur chez le client pour une panne.
//
// POST { action: 'trouver' | 'photo' | 'declarer', ref, tel4, categorie, message, photos, type, lang }
const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');
const { getPointRetrait } = require('./_lib/pointsRetrait');
const { declarerPanne, appareilsLibresAuPoint } = require('./_lib/panne');
const { sendBrevoSms } = require('./_lib/brevo');
const { todayParis, addDays } = require('./_lib/dates');

const T = (lang, fr, en, es) => (lang === 'en' ? en : lang === 'es' ? es : fr);
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  const b = req.body || {};
  const lang = b.lang === 'en' || b.lang === 'es' ? b.lang : 'fr';
  const action = ['trouver', 'photo', 'declarer'].includes(b.action) ? b.action : 'trouver';
  const ref = String(b.ref || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 60);
  const tel4 = String(b.tel4 || '').replace(/\D/g, '').slice(-4);
  if (ref.length < 4 || tel4.length !== 4) {
    return res.status(400).json({ error: T(lang, 'Indiquez votre numéro de commande et les 4 derniers chiffres de votre téléphone.', 'Enter your order number and the last 4 digits of your phone.', 'Indica tu número de pedido y las 4 últimas cifras de tu teléfono.') });
  }

  const supabase = getSupabase();
  const cle = `panne:${getClientIp(req)}`;
  try {
    if (await isRateLimited(supabase, cle)) {
      return res.status(429).json({ error: T(lang, 'Trop d’essais. Réessayez dans 15 minutes, ou écrivez à Julie sur locair.fr.', 'Too many attempts. Try again in 15 minutes, or chat with Julie on locair.fr.', 'Demasiados intentos. Inténtalo en 15 minutos o escribe a Julie en locair.fr.') });
    }
    const { data: lignes } = await supabase.from('reservations').select('*').eq('ref', ref).order('id', { ascending: true }).limit(1);
    let r = lignes && lignes[0];
    if (r && r.reservation_origine_id) {
      const { data: orig } = await supabase.from('reservations').select('*').eq('id', r.reservation_origine_id).maybeSingle();
      if (orig) r = orig;
    }
    const telOk = r && String(r.tel || '').replace(/\D/g, '').slice(-4) === tel4;
    if (!r || !telOk) {
      await recordFailedAttempt(supabase, cle);
      return res.status(404).json({ error: T(lang, 'Location introuvable. Vérifiez le numéro de commande (dans votre email de confirmation) et votre téléphone.', 'Rental not found. Check the order number (in your confirmation email) and your phone.', 'Alquiler no encontrado. Revisa el número de pedido (en tu email de confirmación) y tu teléfono.') });
    }
    const jour = todayParis();
    // la location doit être en cours (on tolère le jour du retrait et le jour du retour)
    const cc = r.source_channel === 'click_collect';
    // en cours = commencée, et pas encore rendue (Click & Collect, même en
    // retard) ou pas encore finie depuis plus d'un jour (livraison)
    const enCours = r.statut === 'confirmee' && r.date_debut <= jour && (cc ? !r.rendu_at : r.date_fin >= addDays(jour, -1));
    const point = cc ? getPointRetrait(r.point_retrait_id || '') : null;

    if (action === 'trouver') {
      return res.status(200).json({
        location: {
          prenom: r.prenom || '', type: cc ? 'click_collect' : 'livraison', en_cours: enCours,
          point: point ? { nom: point.nom, adresse: point.adresse, horaires: point.horaires || '' } : null,
          date_fin: r.date_fin,
        },
      });
    }
    if (!enCours) {
      return res.status(409).json({ error: T(lang, 'Cette location n’est pas en cours. Une question ? Écrivez à Julie sur locair.fr.', 'This rental isn’t ongoing. A question? Chat with Julie on locair.fr.', 'Este alquiler no está en curso. ¿Una pregunta? Escribe a Julie en locair.fr.') });
    }

    if (action === 'photo') {
      const type = String(b.type || 'image/jpeg');
      const ext = EXT[type] || 'jpg';
      const path = `signalements/${r.id}-${crypto.randomBytes(8).toString('hex')}/photo.${ext}`;
      const { data, error } = await supabase.storage.from('missions').createSignedUploadUrl(path);
      if (error) return res.status(500).json({ error: T(lang, 'Envoi de photo indisponible. Envoyez sans photo.', 'Photo upload unavailable. Send without a photo.', 'Envío de foto no disponible. Envía sin foto.') });
      return res.status(200).json({ signedUrl: data.signedUrl, path });
    }

    // declarer
    await recordFailedAttempt(supabase, cle); // limite les déclarations répétées
    const photos = (Array.isArray(b.photos) ? b.photos : []).map(String)
      .filter((x) => x.startsWith(`signalements/${r.id}-`) && !x.includes('..')).slice(0, 3);
    const appareil = ['climatiseur', 'portasplit', 'rafraichisseur'].includes(b.appareil) ? b.appareil : null;
    const out = await declarerPanne(supabase, { r, point, categorie: b.categorie, moment: 'location', message: b.message, photos, canal: 'page /panne', appareil });

    // SMS de confirmation au client : son numéro de dossier et la suite
    const pt = out.point || point;   // client livré : le point le plus proche ; Click & Collect : SON point, toujours
    const ici = cc ? T(r.lang || lang, ', là où vous l’avez retiré', ', where you picked it up', ', donde lo recogiste') : '';
    const l = r.lang || lang;
    const dossier = out.dossier ? ` (dossier ${out.dossier})` : '';
    const sms = {
      rapporter_au_point: T(l, `Loc'Air : panne bien reçue${dossier}. Rapportez l'appareil au point ${pt ? pt.nom + ' (' + pt.adresse + ')' : ''}${ici}, aux horaires d'ouverture : vous repartez avec un autre. Au comptoir, scannez le QR code, touchez « Un problème ? » puis « Il ne marche pas ».`, `Loc'Air: fault received${dossier}. Bring the unit back to ${pt ? pt.nom + ' (' + pt.adresse + ')' : ''}${ici} during opening hours and leave with another one. At the counter, scan the QR code, tap "A problem?" then "Doesn’t work".`, `Loc'Air: avería recibida${dossier}. Devuelve el aparato en ${pt ? pt.nom + ' (' + pt.adresse + ')' : ''}${ici} en horario de apertura y llévate otro. En el mostrador, escanea el código QR, pulsa «¿Un problema?» y luego «No funciona».`),
      reapprovisionnement: T(l, `Loc'Air : panne bien reçue${dossier}. On apporte un climatiseur au point ${pt ? pt.nom : ''} le jour même ou le lendemain. Vous recevez un SMS dès qu'il vous attend.`, `Loc'Air: fault received${dossier}. We're bringing a unit to ${pt ? pt.nom : ''} the same day or the next. You'll get a text as soon as it's waiting for you.`, `Loc'Air: avería recibida${dossier}. Llevamos un aparato a ${pt ? pt.nom : ''} el mismo día o al siguiente. Recibirás un SMS en cuanto te espere.`),
      ticket: T(l, `Loc'Air : votre message est bien reçu${dossier}. On vous rappelle rapidement pour organiser la suite.`, `Loc'Air: message received${dossier}. We'll get back to you quickly.`, `Loc'Air: mensaje recibido${dossier}. Te contactamos rápidamente.`),
    }[out.issue] || null;
    if (sms && r.tel) await sendBrevoSms({ to: r.tel, content: sms }).catch(() => {});

    let libres = null;
    if (pt && out.issue === 'rapporter_au_point') libres = await appareilsLibresAuPoint(supabase, pt).catch(() => null);
    return res.status(200).json({ ok: true, issue: out.issue, dossier: out.dossier, point: pt ? { nom: pt.nom, adresse: pt.adresse, horaires: pt.horaires || '' } : null, libres });
  } catch (e) {
    console.error('[panne]', e.message);
    return res.status(500).json({ error: T(lang, 'Erreur serveur. Réessayez, ou écrivez à Julie sur locair.fr.', 'Server error. Try again, or chat with Julie on locair.fr.', 'Error del servidor. Inténtalo de nuevo o escribe a Julie en locair.fr.') });
  }
};
