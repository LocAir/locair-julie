// Retrait et retour Click & Collect « au comptoir ».
// Un QR code est collé chez le commerçant ; il ouvre /retrait?p=<point>.
// 1. Le client tape son numéro de commande (CC-XXXXXXXX, reçu dans l'email et
//    le SMS de confirmation). C'est le SEUL numéro du séjour : il reste valable
//    après une prolongation, jusqu'au retour. Il est long et tiré au hasard
//    (32^8 possibilités) : impossible à deviner, et les essais sont limités.
// 2. RETRAIT : il montre sa pièce d'identité au commerçant et valide lui-même
//    le retrait sur son téléphone, puis montre l'écran de confirmation au
//    commerçant. RETOUR : il dépose l'appareil dans sa housse, prend une photo,
//    tape le code commerçant (donné par le commerçant, voir
//    clickCollect.codeRetour) et valide (voir apresRetour).
//
// POST { point, ref, action: 'voir'|'valider'|'rendre'|'signaler'|'photo', photo, categorie, message }
// Les règles (dates, statut, colonnes) sont celles de _lib/remiseCC.js,
// communes avec l'espace partenaire.
const { getSupabase } = require('./_lib/supabase');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');
const { getPointRetrait } = require('./_lib/pointsRetrait');
const { agir } = require('./_lib/remiseCC');
const { codeRetour } = require('./_lib/clickCollect');
const { safeEqual } = require('./_lib/auth');
const { verifyPin } = require('./_lib/pinHash');
const { pushToAdmin } = require('./_lib/push');

const T = (lang, fr, en, es) => (lang === 'en' ? en : lang === 'es' ? es : fr);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.TRANSPORTEUR_SECRET) return res.status(500).json({ error: 'Erreur de configuration.' });
  res.setHeader('Cache-Control', 'no-store');

  const b = req.body || {};
  const lang = b.lang === 'en' || b.lang === 'es' ? b.lang : 'fr';
  const point = getPointRetrait(String(b.point || '').slice(0, 60));
  const ref = String(b.ref || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 40);
  const action = ['voir', 'valider', 'rendre', 'signaler', 'photo'].includes(b.action) ? b.action : 'voir';
  if (!point) return res.status(404).json({ error: T(lang, 'Ce QR code ne correspond à aucun point de retrait.', 'This QR code doesn’t match any pick-up point.', 'Este código QR no corresponde a ningún punto de recogida.') });
  if (ref.length < 6) return res.status(400).json({ error: T(lang, 'Indiquez votre numéro de commande.', 'Enter your order number.', 'Indica tu número de pedido.') });

  const supabase = getSupabase();
  const ip = getClientIp(req);
  const cleClient = `comptoir:${ip}`;
  try {
    if (await isRateLimited(supabase, cleClient)) {
      return res.status(429).json({ error: T(lang, 'Trop d’essais. Réessayez dans 15 minutes ou écrivez à Julie sur locair.fr.', 'Too many attempts. Try again in 15 minutes or chat with Julie on locair.fr.', 'Demasiados intentos. Vuelve a intentarlo en 15 minutos o escribe a Julie en locair.fr.') });
    }
    const { data: lignes } = await supabase.from('reservations').select('*')
      .eq('ref', ref).eq('source_channel', 'click_collect').order('id', { ascending: true }).limit(1);
    let r = lignes && lignes[0];
    // Numéro d'une prolongation tapé par erreur : on revient à la location d'origine.
    if (r && r.reservation_origine_id) {
      const { data: orig } = await supabase.from('reservations').select('*').eq('id', r.reservation_origine_id).maybeSingle();
      if (orig) r = orig;
    }
    if (!r) {
      await recordFailedAttempt(supabase, cleClient);
      return res.status(404).json({ error: T(lang, 'Numéro de commande introuvable. Vérifiez-le dans votre email de confirmation.', 'Order number not found. Check it in your confirmation email.', 'Número de pedido no encontrado. Revísalo en tu email de confirmación.') });
    }
    if ((r.point_retrait_id || '') !== point.id) {
      const prevu = getPointRetrait(r.point_retrait_id || '');
      return res.status(409).json({ error: T(lang, `Votre réservation est prévue dans un autre point : ${prevu ? prevu.nom : 'voir votre email de confirmation'}.`, `Your booking is at another pick-up point: ${prevu ? prevu.nom : 'see your confirmation email'}.`, `Tu reserva es en otro punto: ${prevu ? prevu.nom : 'mira tu email de confirmación'}.`) });
    }

    // Le commerçant du point : celui de la réservation, sinon celui du point.
    let partenaire = null;
    if (r.partenaire_id) {
      ({ data: partenaire } = await supabase.from('partenaires').select('id, code, pin, pin_hashed, actif, telephone').eq('id', r.partenaire_id).maybeSingle());
    } else if (point.partenaire_code) {
      ({ data: partenaire } = await supabase.from('partenaires').select('id, code, pin, pin_hashed, actif, telephone').eq('code', String(point.partenaire_code).toLowerCase()).maybeSingle());
    }

    // SIGNALER un problème (casse, appareil abîmé…) au retrait ou au retour :
    // enregistré comme incident sur la réservation + alerte à l'admin.
    // Ne bloque rien : le client peut ensuite valider normalement.
    // PHOTO jointe à un signalement : lien d'envoi direct vers le stockage
    // privé (bucket « missions »), rangé sous le numéro de la réservation.
    if (action === 'photo') {
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heic' }[String(b.type || '')] || 'jpg';
      const path = `signalements/${r.id}-${require('crypto').randomBytes(8).toString('hex')}/photo.${ext}`;
      const { data: up, error: upErr } = await supabase.storage.from('missions').createSignedUploadUrl(path, { upsert: false });
      if (upErr) { console.error('[cc-comptoir photo]', upErr.message); return res.status(500).json({ error: T(lang, 'Envoi de photo indisponible. Envoyez le signalement sans photo.', 'Photo upload unavailable. Send the report without a photo.', 'Envío de foto no disponible. Envía el aviso sin foto.') }); }
      return res.status(200).json({ path: up.path, signedUrl: up.signedUrl });
    }

    if (action === 'signaler') {
      const CATS = { casse: ['materiel_endommage', 'Casse'], abime: ['materiel_endommage', 'Appareil abîmé'], manque: ['autre', 'Élément manquant'], panne: ['probleme_technique', 'Ne fonctionne pas'], autre: ['autre', 'Autre'] };
      const cat = CATS[b.categorie] || CATS.autre;
      const moment = b.moment === 'retour' ? 'retour' : 'retrait';
      const message = String(b.message || '').replace(/\s+/g, ' ').trim().slice(0, 500);
      await recordFailedAttempt(supabase, cleClient); // limite les envois répétés (même compteur que les essais)
      const description = `[Click & Collect · déclaré par le client au ${moment} · ${point.nom}] ${cat[1]}${message ? ' — ' + message : ''}`;
      // photos : seulement celles rangées sous CETTE réservation (3 au plus)
      const photos = (Array.isArray(b.photos) ? b.photos : []).map(String)
        .filter((x) => x.startsWith(`signalements/${r.id}-`) && !x.includes('..')).slice(0, 3);
      const { error: incErr } = await supabase.from('incidents').insert({ city_id: r.city_id || null, reservation_id: r.id, type: cat[0], description, photos: photos.length ? photos : null, statut: 'nouveau' });
      if (incErr) console.error('[cc-comptoir signaler]', incErr.message);
      await pushToAdmin(supabase, { title: `⚠️ Click & Collect — ${cat[1].toLowerCase()} signalé(e)`, body: `${r.ref} — ${r.prenom || ''} ${r.nom || ''} — ${point.nom} (${moment})${message ? ' : ' + message : ''}${photos.length ? ' · 📷 ' + photos.length + ' photo(s)' : ''}`.trim(), tag: `cc-signal-${r.id}-${Date.now()}` }).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    if (action === 'voir') {
      if (!partenaire) {
        // On montre quand même la réservation, mais la remise passera par Loc'Air.
        const out = await agir(supabase, r, null, 'voir');
        if (out.body && out.body.reservation) out.body.reservation.sans_commercant = true;
        return res.status(out.status).json(out.body);
      }
      const out = await agir(supabase, r, partenaire.id, 'voir');
      return res.status(out.status).json(out.body);
    }

    // RETRAIT : le client le valide lui-même avec son numéro de commande,
    // après avoir montré sa pièce d'identité au commerçant (décision du
    // propriétaire, 20/11/2026). Le commerçant n'a rien à taper.
    if (action === 'valider') {
      const out = await agir(supabase, r, partenaire ? partenaire.id : null, 'valider');
      return res.status(out.status).json(out.body);
    }

    // RETOUR (décision du propriétaire, 20/11/2026) : le client dépose le
    // climatiseur dans sa housse, prend UNE photo (preuve du dépôt), tape le
    // code que lui donne le commerçant (sinon on pourrait déclarer « rendu »
    // depuis chez soi) et valide. La location est close, le client
    // reçoit sa confirmation de retour + sa facture, l'appareil passe
    // « À reconditionner » (page admin/cc-retours.html).
    if (action === 'rendre') {
      const photo = String(b.photo || '');
      if (!photo.startsWith(`signalements/${r.id}-`) || photo.includes('..')) {
        return res.status(400).json({ error: T(lang, 'Prenez une photo du climatiseur dans sa housse pour valider le retour.', 'Take a photo of the air conditioner in its cover to confirm the return.', 'Haz una foto del aire acondicionado en su funda para confirmar la devolución.'), code: 'photo_requise' });
      }
      const cr = codeRetour(point, partenaire);
      if (!cr && !(partenaire && partenaire.pin)) {
        return res.status(409).json({ error: T(lang, 'Ce point n’a pas encore de code commerçant. Écrivez à Julie sur locair.fr : on valide votre retour.', 'This point has no shop code yet. Chat with Julie on locair.fr: we’ll confirm your return.', 'Este punto aún no tiene código de comercio. Escribe a Julie en locair.fr: confirmamos tu devolución.') });
      }
      const cleCode = `comptoir-code:${point.id}`;
      if (await isRateLimited(supabase, cleCode)) {
        return res.status(429).json({ error: T(lang, 'Trop de codes incorrects. Réessayez dans 15 minutes.', 'Too many wrong codes. Try again in 15 minutes.', 'Demasiados códigos incorrectos. Inténtalo en 15 minutos.') });
      }
      // Le code commerçant (2 derniers chiffres du téléphone de la boutique).
      // Le code secret du commerçant marche aussi, s'il préfère le taper lui-même.
      const code = String(b.code_commercant || '').replace(/\s/g, '').slice(0, 12);
      const bon = !!code && ((cr && safeEqual(code, cr))
        || (partenaire && partenaire.pin && (partenaire.pin_hashed ? verifyPin(code, partenaire.pin) : safeEqual(code, String(partenaire.pin)))));
      if (!bon) {
        await recordFailedAttempt(supabase, cleCode);
        return res.status(401).json({ error: T(lang, code ? 'Code commerçant incorrect. Demandez-le au commerçant.' : 'Demandez le code commerçant au commerçant et tapez-le.', code ? 'Wrong shop code. Ask the shopkeeper.' : 'Ask the shopkeeper for the shop code and enter it.', code ? 'Código de comercio incorrecto. Pídeselo al comerciante.' : 'Pide el código de comercio al comerciante e introdúcelo.'), code: 'code_commercant' });
      }
      const out = await agir(supabase, r, partenaire ? partenaire.id : null, 'rendre');
      if (out.status === 200 && out.body && out.body.ok && !out.body.deja) {
        await apresRetour(supabase, r, point, photo, lang).catch((e) => console.error('[cc-comptoir après retour]', e.message));
      }
      return res.status(out.status).json(out.body);
    }
    return res.status(400).json({ error: 'Action inconnue.' });
  } catch (e) {
    console.error('[cc-comptoir]', e.message);
    return res.status(500).json({ error: T(lang, 'Erreur serveur. Réessayez.', 'Server error. Please try again.', 'Error del servidor. Inténtalo de nuevo.') });
  }
};

// Après un retour validé : photo + état « à reconditionner » sur la
// réservation, puis confirmation au client (email + SMS) avec sa facture.
// Colonnes retour_photo / etat_retour : supabase/migration_2026-11-20_cc_retour_photo.sql.
// Tant qu'elles n'existent pas, la photo part dans les consignes (rien n'est perdu).
async function apresRetour(supabase, r, point, photo, lang) {
  const { error } = await supabase.from('reservations').update({ retour_photo: photo, etat_retour: 'a_reconditionner' }).eq('id', r.id);
  if (error) {
    await supabase.from('reservations').update({ instructions_acces: `${r.instructions_acces || ''} | PHOTO RETOUR : ${photo} | À RECONDITIONNER`.slice(0, 1000) }).eq('id', r.id);
  }
  // facture : celle déjà générée au paiement si elle existe, sinon l'espace client
  const { data: docs } = await supabase.from('documents').select('access_token').eq('reservation_id', r.id).eq('type', 'facture')
    .order('id', { ascending: false }).limit(1);
  const lienFacture = docs && docs[0] ? `https://www.locair.fr/api/document-view?token=${docs[0].access_token}` : 'https://www.locair.fr/client';
  const l = r.lang === 'en' || r.lang === 'es' ? r.lang : (lang || 'fr');
  const Tx = (fr, en, es) => (l === 'en' ? en : l === 'es' ? es : fr);
  const quand = new Date().toLocaleString(l === 'en' ? 'en-GB' : l === 'es' ? 'es-ES' : 'fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const { sendBrevoEmail, sendBrevoSms } = require('./_lib/brevo');
  if (r.email) {
    await sendBrevoEmail({
      to: r.email, senderName: "Loc'Air",
      subject: Tx(`Retour confirmé — ${r.ref}`, `Return confirmed — ${r.ref}`, `Devolución confirmada — ${r.ref}`),
      html: `<div style="font-family:Arial,sans-serif;color:#0E1726;max-width:560px">
<h2 style="color:#1A5EDB;margin:0 0 12px">${Tx('Merci', 'Thank you', 'Gracias')} ${esc(r.prenom || '')} !</h2>
<p>${Tx(`Votre climatiseur a bien été rendu au point <b>${esc(point.nom)}</b>, ${esc(quand)}. Votre location est terminée.`, `Your air conditioner was returned to <b>${esc(point.nom)}</b>, ${esc(quand)}. Your rental is over.`, `Tu aire acondicionado se devolvió en <b>${esc(point.nom)}</b>, ${esc(quand)}. Tu alquiler ha terminado.`)}</p>
<p style="margin:16px 0"><a href="${esc(lienFacture)}" style="display:inline-block;background:#1A5EDB;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px">${Tx('Voir ma facture', 'View my invoice', 'Ver mi factura')}</a></p>
<p style="color:#4B5873;font-size:13px">${Tx('Référence', 'Reference', 'Referencia')} : ${esc(r.ref || '')} · Loc’Air · locair.fr</p></div>`,
    }).catch(() => {});
  }
  if (r.tel) {
    await sendBrevoSms({ to: r.tel, content: Tx(`Loc'Air : retour confirmé (${r.ref}). Merci ! Votre facture : ${lienFacture}`, `Loc'Air: return confirmed (${r.ref}). Thank you! Your invoice: ${lienFacture}`, `Loc'Air: devolución confirmada (${r.ref}). ¡Gracias! Tu factura: ${lienFacture}`) }).catch(() => {});
  }
}
