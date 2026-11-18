// Paiement Click & Collect (page /click-and-collect).
// Même mécanique que api/checkout.js (PaymentIntent Stripe + réservation
// « en_attente », confirmée par le webhook), en plus simple : pas de
// livraison, pas d'installation, un seul appareil.
//
// Ce que le serveur ne croit JAMAIS du navigateur :
//   - le point : relu dans _lib/pointsRetrait.js (inconnu ou EXEMPLE = refusé) ;
//   - le prix : recalculé avec le barème en base (pricing_config) ;
//   - les dates : retrait ≥ aujourd'hui, point ouvert ce jour-là et le jour
//     du retour, durée entre le minimum du barème et 90 jours ;
//   - le stock : vérifié comme pour une livraison.
//
// La réservation est repérée par source_channel = 'click_collect' : le
// webhook envoie alors un SMS et un email « retrait » (pas « livraison »),
// et les rappels de livraison/récupération à domicile ne partent pas
// (voir _lib/emailSchedule.js). Aucune colonne nouvelle : rien à migrer.
const Stripe = require('stripe');
const { getSupabase } = require('./_lib/supabase');
const { resolveCityByAddress } = require('./_lib/city');
const { getAvailability } = require('./_lib/stock');
const { isValidDate, addDays, todayParis } = require('./_lib/dates');
const { calcTieredPrice, getPricingConfig } = require('./_lib/pricing');
const { CGV_VERSION, ACCEPTANCE_TYPES } = require('./_lib/legal');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');
const { getPointRetrait, codePostalDuPoint, pointFermeLe } = require('./_lib/pointsRetrait');

const JOURS_MAX = 90;
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  try {
    if (await isRateLimited(getSupabase(), `checkout:${ip}`)) return res.status(429).json({ error: 'Trop de tentatives, réessayez dans 15 minutes.' });
  } catch (e) { console.error('[CC rateLimit]', e.message); }

  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Configuration serveur manquante — contactez-nous.' });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const data = req.body && typeof req.body === 'object' ? req.body : {};

  // Mêmes trois acceptations que le paiement avec livraison (voir checkout.js).
  if (data.cgv_accepted !== true || data.conditions_utilisation_accepted !== true || data.retard_accepted !== true) {
    return res.status(400).json({ error: 'Merci d’accepter les conditions avant de payer.' });
  }

  const prenom = clip(data.prenom, 100), nom = clip(data.nom, 100);
  const email = clip(data.email, 200).toLowerCase();
  const tel = clip(data.tel, 30);
  if (!prenom || !nom) return res.status(400).json({ error: 'Prénom et nom requis.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Adresse email invalide.' });
  if (tel.replace(/\D/g, '').length < 9) return res.status(400).json({ error: 'Numéro de téléphone invalide.' });

  // Pièce d'identité obligatoire : carte (recto + verso) ou passeport, déjà
  // envoyée dans le bucket privé via /api/upload-identite. On n'accepte que
  // des chemins de ce dossier, jamais un chemin arbitraire.
  const pi = data.piece_identite && typeof data.piece_identite === 'object' ? data.piece_identite : {};
  const attendu = pi.type === 'cni' ? 2 : pi.type === 'passeport' ? 1 : 0;
  const chemins = Array.isArray(pi.paths) ? pi.paths.map((x) => clip(x, 200)) : [];
  if (!attendu || chemins.length !== attendu || !chemins.every((x) => /^identites\/\d+-[a-f0-9]{18}\/(recto|verso|passeport)\.(jpg|png|webp|heic|heif|pdf)$/.test(x))) {
    return res.status(400).json({ error: 'Merci d’ajouter votre pièce d’identité (carte recto et verso, ou passeport).' });
  }

  const point = getPointRetrait(clip(data.point_id, 60));
  if (!point) return res.status(400).json({ error: 'Point de retrait inconnu.' });
  if (point.exemple) return res.status(409).json({ error: 'Ce point de retrait n’est pas encore ouvert au paiement en ligne. Réservez par WhatsApp ou au 06 63 79 87 56.' });

  const pricing = await getPricingConfig(getSupabase());
  const dateDebut = clip(data.date, 10);
  const duree = parseInt(data.jours, 10);
  if (!isValidDate(dateDebut) || dateDebut < todayParis()) return res.status(400).json({ error: 'Date de retrait invalide.' });
  if (!Number.isFinite(duree) || duree < pricing.duree_min_jours || duree > JOURS_MAX) {
    return res.status(400).json({ error: `Durée : entre ${pricing.duree_min_jours} et ${JOURS_MAX} jours.` });
  }
  const dateFin = addDays(dateDebut, duree);
  if (pointFermeLe(point, dateDebut) || pointFermeLe(point, dateFin)) {
    return res.status(400).json({ error: 'Le point de retrait est fermé ce jour-là. Choisissez une autre date.' });
  }

  const amountCents = Math.round(calcTieredPrice(duree, pricing) * 100);
  if (!amountCents || amountCents < 5000) return res.status(400).json({ error: 'Montant invalide.' });

  const supabase = getSupabase();
  const cp = codePostalDuPoint(point);
  let city;
  try {
    city = await resolveCityByAddress(supabase, point.adresse, cp);
  } catch (e) {
    console.error('[CC resolveCity]', e.message);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
  if (!city) return res.status(422).json({ error: 'Ce point n’est rattaché à aucune ville Loc’Air — contactez-nous.' });

  try {
    const dispo = await getAvailability(supabase, city.id, dateDebut, dateFin);
    if (dispo < 1) return res.status(409).json({ error: 'Plus d’appareil disponible à ces dates. Essayez d’autres dates ou appelez-nous.' });
  } catch (e) {
    console.error('[CC dispo]', e.message);
    return res.status(503).json({ error: 'Impossible de vérifier la disponibilité. Réessayez dans un instant.' });
  }

  const ref = clip(data._ref, 40) || ('CC-' + Date.now().toString(36).toUpperCase());
  const adresseResa = `CLICK & COLLECT — ${point.nom} — ${point.adresse}`;

  try {
    // Client Stripe (comme checkout.js) : carte gardée pour un éventuel
    // retard de restitution, sans blocage de fonds.
    let customerId = '';
    const existing = await stripe.customers.list({ email, limit: 1 });
    if (existing.data.length) customerId = existing.data[0].id;
    else customerId = (await stripe.customers.create({ email, name: `${prenom} ${nom}`, phone: tel })).id;

    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      setup_future_usage: 'off_session',
      customer: customerId,
      receipt_email: email,
      description: `Loc'Air — Click & Collect — ${duree} jours — retrait ${dateDebut} — ${point.nom}`.slice(0, 1000),
      metadata: {
        mode: 'click_collect',
        ref, prenom, nom, tel, email,
        adresse: adresseResa.slice(0, 500),
        point_id: point.id, point_nom: point.nom,
        duree: String(duree), quantite: '1',
        date: dateDebut, date_fin: dateFin,
        creneau: 'Retrait au point — heure confirmée par téléphone',
        installation: 'Click & Collect (retrait par le client)',
        frais_livraison: '0 EUR',
        customer_id: customerId,
        campagne: clip(data.campagne, 400),
        piece_identite: pi.type,
      },
    }, { idempotencyKey: `cc-${ref}-${amountCents}-${dateDebut}-${point.id}` });

    const ligne = {
      city_id: city.id,
      hors_zone: false,
      express: false,
      ref,
      stripe_payment_intent_id: intent.id,
      stripe_customer_id: customerId,
      prenom, nom, email, tel,
      adresse: adresseResa.slice(0, 500),
      installation: 'Click & Collect (retrait par le client)',
      instructions_acces: `CLICK & COLLECT : déposer l'appareil (avec son kit de fenêtre) au point « ${point.nom} » (${point.adresse}). Le client vient le chercher le ${dateDebut} et le rapporte au même point. Récupération = reprendre l'appareil au point.`.slice(0, 1000),
      creneau: 'Retrait au point — heure confirmée par téléphone',
      date_debut: dateDebut,
      date_fin: dateFin,
      quantite: 1,
      prix_total_cents: amountCents,
      statut: 'en_attente',
      source: 'site',
      source_channel: 'click_collect',
      lang: 'fr',
      type_client: 'particulier',
      cgv_accepted_at: new Date().toISOString(),
      piece_identite_paths: chemins,
    };
    let { data: resa, error: insertErr } = await supabase.from('reservations').insert(ligne).select('id').single();
    // Colonne piece_identite_paths pas encore créée en base (migration SQL à
    // passer par le propriétaire) : on enregistre quand même la réservation,
    // les chemins de la pièce d'identité partant dans les consignes, pour ne
    // rien perdre. Voir supabase/migration_2026-11-18_piece_identite.sql.
    if (insertErr && /piece_identite_paths/.test(insertErr.message || '')) {
      delete ligne.piece_identite_paths;
      ligne.instructions_acces = `${ligne.instructions_acces} | PIÈCE D'IDENTITÉ (${pi.type}) : ${chemins.join(' ; ')}`.slice(0, 1000);
      ({ data: resa, error: insertErr } = await supabase.from('reservations').insert(ligne).select('id').single());
    }

    if (insertErr) {
      console.error('[CC insert]', insertErr.message);
      await stripe.paymentIntents.cancel(intent.id).catch((e) => console.error('[CC cancel]', e.message));
      return res.status(500).json({ error: 'Erreur serveur réservation.' });
    }

    try {
      const now = new Date().toISOString();
      await supabase.from('cgv_acceptations').insert([
        { reservation_id: resa.id, type: ACCEPTANCE_TYPES.CGV_LOCATION,           version: CGV_VERSION, accepted_at: now },
        { reservation_id: resa.id, type: ACCEPTANCE_TYPES.CONDITIONS_UTILISATION, version: CGV_VERSION, accepted_at: now },
        { reservation_id: resa.id, type: ACCEPTANCE_TYPES.AUTORISATION_RETARD,    version: CGV_VERSION, accepted_at: now },
      ]);
    } catch (e) { console.error('[CC CGV]', e.message); }

    return res.status(200).json({ clientSecret: intent.client_secret, amountCents, ref });
  } catch (err) {
    console.error('[CC Stripe]', err.message);
    await recordFailedAttempt(supabase, `checkout:${ip}`).catch(() => {});
    return res.status(500).json({ error: 'Erreur serveur paiement.' });
  }
};
