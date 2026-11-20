// Retrait et retour Click & Collect « au comptoir ».
// Un QR code est collé chez le commerçant ; il ouvre /retrait?p=<point>.
// 1. Le client tape son numéro de commande (CC-XXXXXXXX, reçu dans l'email et
//    le SMS de confirmation). C'est le SEUL numéro du séjour : il reste valable
//    après une prolongation, jusqu'au retour. Il est long et tiré au hasard
//    (32^8 possibilités) : impossible à deviner, et les essais sont limités.
// 2. RETRAIT : il montre sa pièce d'identité au commerçant et valide lui-même
//    le retrait sur son téléphone. RETOUR : le commerçant vérifie l'appareil et
//    donne au client son « code retour du jour » (espace partenaire, change
//    chaque jour) ; le client le tape pour valider. Sans ce code, aucun retour
//    n'est enregistré : une carte QR prise en photo ne suffit pas.
//
// POST { point, ref, action: 'voir'|'valider'|'rendre', code_commercant }
// Les règles (dates, statut, colonnes) sont celles de _lib/remiseCC.js,
// communes avec l'espace partenaire.
const { getSupabase } = require('./_lib/supabase');
const { safeEqual } = require('./_lib/auth');
const { verifyPin } = require('./_lib/pinHash');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');
const { getPointRetrait } = require('./_lib/pointsRetrait');
const { agir } = require('./_lib/remiseCC');
const { codeRetourDuJour } = require('./_lib/clickCollect');
const { todayParis } = require('./_lib/dates');

const T = (lang, fr, en, es) => (lang === 'en' ? en : lang === 'es' ? es : fr);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.TRANSPORTEUR_SECRET) return res.status(500).json({ error: 'Erreur de configuration.' });
  res.setHeader('Cache-Control', 'no-store');

  const b = req.body || {};
  const lang = b.lang === 'en' || b.lang === 'es' ? b.lang : 'fr';
  const point = getPointRetrait(String(b.point || '').slice(0, 60));
  const ref = String(b.ref || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 40);
  const action = ['voir', 'valider', 'rendre'].includes(b.action) ? b.action : 'voir';
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
      ({ data: partenaire } = await supabase.from('partenaires').select('id, code, pin, pin_hashed, actif').eq('id', r.partenaire_id).maybeSingle());
    } else if (point.partenaire_code) {
      ({ data: partenaire } = await supabase.from('partenaires').select('id, code, pin, pin_hashed, actif').eq('code', String(point.partenaire_code).toLowerCase()).maybeSingle());
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

    // RETOUR : le commerçant confirme avec son code (sinon un client pourrait
    // déclarer « rendu » depuis chez lui sans rapporter l'appareil).
    if (!partenaire || partenaire.actif === false) {
      return res.status(409).json({ error: T(lang, 'Ce point n’est pas encore relié à un commerçant. Le commerçant peut écrire à Loc’Air.', 'This point isn’t linked to a shop yet. The shop can contact Loc’Air.', 'Este punto aún no está vinculado a un comercio. El comercio puede contactar con Loc’Air.') });
    }
    const cleCommercant = `comptoir-commercant:${partenaire.id}`;
    if (await isRateLimited(supabase, cleCommercant)) {
      return res.status(429).json({ error: T(lang, 'Trop d’essais du code retour. Réessayez dans 15 minutes.', 'Too many wrong return codes. Try again in 15 minutes.', 'Demasiados códigos de devolución incorrectos. Vuelve a intentarlo en 15 minutos.') });
    }
    // Le client tape le « code retour du jour » donné par le commerçant (affiché
    // dans son espace partenaire). Le code secret du commerçant marche aussi,
    // s'il préfère le taper lui-même.
    const code = String(b.code_commercant || '').trim();
    const bon = code && (safeEqual(code, codeRetourDuJour(partenaire.id, todayParis()))
      || (partenaire.pin_hashed ? verifyPin(code, partenaire.pin) : safeEqual(code, partenaire.pin || '')));
    if (!bon) {
      await recordFailedAttempt(supabase, cleCommercant);
      return res.status(401).json({ error: T(lang, 'Code retour incorrect. Demandez au commerçant le code du jour.', 'Wrong return code. Ask the shopkeeper for today’s code.', 'Código de devolución incorrecto. Pide al comerciante el código del día.'), code: 'code_commercant' });
    }
    const out = await agir(supabase, r, partenaire.id, action);
    return res.status(out.status).json(out.body);
  } catch (e) {
    console.error('[cc-comptoir]', e.message);
    return res.status(500).json({ error: T(lang, 'Erreur serveur. Réessayez.', 'Server error. Please try again.', 'Error del servidor. Inténtalo de nuevo.') });
  }
};
