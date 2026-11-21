// Paiement Click & Collect (page /click-and-collect).
// Même mécanique que api/checkout.js (PaymentIntent Stripe + réservation
// « en_attente », confirmée par le webhook), en plus simple : pas de
// livraison, pas d'installation, 1 à 3 appareils au même point (un seul numéro).
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
const { isValidDate, addDays, todayParis } = require('./_lib/dates');
const { getPricingConfig, isSiretValide } = require('./_lib/pricing');
const { getAvailability } = require('./_lib/stock');
const { CGV_VERSION, ACCEPTANCE_TYPES } = require('./_lib/legal');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');
const { getPointRetrait, codePostalDuPoint, pointFermeLe } = require('./_lib/pointsRetrait');
const { prixClickCollect, lienRemise, imageQrRemise, codeIdentite, numeroComptoir } = require('./_lib/clickCollect');
const { lireDevis } = require('./_lib/tarifDynamique');

const JOURS_MAX = 90;
// Plusieurs climatiseurs dans UNE commande (un seul numéro, même point) :
// 3 au plus en ligne ; au-delà, devis par téléphone.
const QTE_MAX = 3;
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
  // Adresse postale du client : pour le contrat, et pour pouvoir le joindre
  // par courrier si l'appareil n'est jamais rendu.
  const adresseClient = clip(data.adresse_client, 300);
  if (adresseClient.length < 8) return res.status(400).json({ error: 'Adresse postale requise.', code: 'adresse_invalide' });
  // Facture au nom d'une société (facultatif). Le SIRET est facultatif
  // (société étrangère), mais s'il est donné il doit être valide. Le prix ne
  // change pas : c'est seulement le nom sur la facture.
  const raisonSociale = clip(data.raison_sociale, 200);
  const siretClient = String(data.siret || '').replace(/\s/g, '').slice(0, 20);
  if (raisonSociale && siretClient && !isSiretValide(siretClient)) {
    return res.status(400).json({ error: 'Numéro SIRET invalide.', code: 'siret_invalide' });
  }

  // Pièce d'identité : carte (recto + verso) ou passeport. Elle est en
  // principe ajoutée APRÈS le paiement (api/click-collect-identite.js), pour
  // ne pas freiner la réservation ; si le navigateur l'envoie déjà ici, on la
  // vérifie. On n'accepte que des chemins du dossier identites/, jamais un
  // chemin arbitraire. Le commerçant vérifie la pièce au retrait dans tous
  // les cas.
  const pi = data.piece_identite && typeof data.piece_identite === 'object' ? data.piece_identite : {};
  const attendu = pi.type === 'cni' ? 2 : pi.type === 'passeport' ? 1 : 0;
  const chemins = Array.isArray(pi.paths) ? pi.paths.map((x) => clip(x, 200)) : [];
  if (pi.type || chemins.length) {
    if (!attendu || chemins.length !== attendu || !chemins.every((x) => /^identites\/\d+-[a-f0-9]{18}\/(recto|verso|passeport)\.(jpg|png|webp|heic|heif|pdf)$/.test(x))) {
      return res.status(400).json({ error: 'Pièce d’identité incomplète (carte recto et verso, ou passeport).' });
    }
  }

  const point = getPointRetrait(clip(data.point_id, 60));
  if (!point) return res.status(400).json({ error: 'Point de retrait inconnu.' });
  if (point.exemple) return res.status(409).json({ error: 'Ce point de retrait n’est pas encore ouvert au paiement en ligne. Choisissez un autre point, ou écrivez à Julie sur la page.' });

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

  const qte = Math.min(QTE_MAX, Math.max(1, parseInt(data.quantite, 10) || 1));
  const supabase = getSupabase();
  // Prix (tarification dynamique, _lib/tarifDynamique.js) et stock du point :
  // même calcul que celui affiché sur la page (api/click-collect-prix.js).
  let prix;
  try { prix = await prixClickCollect(supabase, point, dateDebut, duree, pricing); }
  catch (e) { console.error('[CC prix]', e.message); return res.status(503).json({ error: 'Impossible de calculer le prix. Réessayez dans un instant.' }); }
  if (prix.libresAuPoint < 1) return res.status(409).json({ error: 'Ce point de retrait est complet à ces dates. Choisissez un autre point ou d’autres dates.' });
  if (prix.libresAuPoint < qte) return res.status(409).json({ error: `Il reste ${prix.libresAuPoint} appareil${prix.libresAuPoint > 1 ? 's' : ''} à ce point sur ces dates.`, libres: prix.libresAuPoint });
  // Prix garanti 30 min : si le client a un devis signé (prix affiché sur la
  // page), il ne paie jamais plus que ce devis ; si le prix a baissé depuis,
  // il paie le prix plus bas. Toujours entre le barème et le plafond.
  const garanti = lireDevis(data.devis, { point: point.id, debut: dateDebut, jours: duree });
  // prix d'UN appareil (devis et prix vu sont par appareil), puis × quantité
  let unitCents = prix.totalCents;
  if (garanti) unitCents = Math.max(prix.plancherCents || prix.normalCents, Math.min(prix.totalCents, garanti));
  if (!unitCents || unitCents < 5000) return res.status(400).json({ error: 'Montant invalide.' });
  const amountCents = unitCents * qte;
  // Sans devis valable : le prix vu par le client ne doit jamais changer sans qu'il le sache.
  const vu = parseInt(data.prix_vu_cents, 10);
  if (!garanti && Number.isFinite(vu) && vu !== unitCents) {
    return res.status(409).json({ error: 'Le prix vient de changer pour ces dates (forte demande). Vérifiez le nouveau prix avant de payer.', nouveauPrixCents: unitCents, majore: prix.majore });
  }

  // Commerçant du point : la réservation lui est rattachée et sa commission
  // (15 % de la location payée) comptée, comme pour les autres partenaires
  // (espace partenaire, virements). Point sans partenaire = pas de commission.
  let partenaireId = null, commissionCents = 0;
  if (point.partenaire_code) {
    try {
      const { data: part } = await supabase.from('partenaires').select('id').eq('code', String(point.partenaire_code).toLowerCase()).eq('actif', true).maybeSingle();
      if (part) { partenaireId = part.id; commissionCents = Math.round(amountCents * point.commission_pct / 100); }
    } catch (e) { console.error('[CC partenaire]', e.message); }
  }
  const cp = codePostalDuPoint(point);
  let city;
  try {
    city = await resolveCityByAddress(supabase, point.adresse, cp);
  } catch (e) {
    console.error('[CC resolveCity]', e.message);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
  if (!city) return res.status(422).json({ error: 'Ce point n’est rattaché à aucune ville Loc’Air — contactez-nous.' });

  // Double contrôle : le stock du point (ci-dessus) ET les appareils
  // réellement enregistrés pour la ville dans l'admin.
  try {
    const dispo = await getAvailability(supabase, city.id, dateDebut, dateFin);
    if (dispo < qte) return res.status(409).json({ error: 'Plus d’appareil disponible à ces dates. Essayez d’autres dates ou appelez-nous.' });
  } catch (e) {
    console.error('[CC dispo]', e.message);
    return res.status(503).json({ error: 'Impossible de vérifier la disponibilité. Réessayez dans un instant.' });
  }

  // Référence toujours créée ici, jamais reprise du navigateur : réutiliser
  // celle d'un essai précédent (carte refusée) bloquait tout nouveau paiement.
  // NUMÉRO À 4 CHIFFRES (tapé au comptoir) :
  //  - un client qui a déjà une location Click & Collect en cours GARDE SON
  //    NUMÉRO, même dans un autre point (ex. 2 à Nice + 2 à Cannes faute de
  //    stock) : la nouvelle référence est tirée pour donner le même numéro ;
  //  - ce numéro ne doit pas être celui d'un AUTRE client encore en cours au
  //    même point ; sinon (très rare), on lui donne un nouveau numéro.
  const nouvelle = () => 'CC-' + Array.from(require('crypto').randomBytes(8), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  let ref = nouvelle();
  try {
    const depuis = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
    const telCle = tel.replace(/\D/g, '').slice(-9);
    const memeClient = (x) => String(x.email || '').toLowerCase() === email || (telCle.length === 9 && String(x.tel || '').replace(/\D/g, '').slice(-9) === telCle);
    const { data: ouvertes } = await supabase.from('reservations').select('ref, email, tel, point_retrait_id, id')
      .eq('source_channel', 'click_collect').is('reservation_origine_id', null)
      .in('statut', ['en_attente', 'confirmee']).gte('date_fin', depuis).order('id', { ascending: false }).limit(3000);
    const toutes = ouvertes || [];
    const pris = new Set(toutes.filter((x) => x.point_retrait_id === point.id && !memeClient(x)).map((x) => numeroComptoir(x.ref)));
    const sienne = toutes.find(memeClient);
    const voulu = sienne ? numeroComptoir(sienne.ref) : null;
    if (voulu && !pris.has(voulu)) {
      // ~10 000 essais en moyenne (quelques millisecondes)
      for (let i = 0; i < 200000 && numeroComptoir(ref) !== voulu; i++) ref = nouvelle();
      if (numeroComptoir(ref) !== voulu) ref = nouvelle();
    }
    for (let i = 0; i < 50 && pris.has(numeroComptoir(ref)); i++) ref = nouvelle();
  } catch (e) { console.error('[CC numéro comptoir]', e.message); }
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
      description: `Loc'Air — Click & Collect — ${qte > 1 ? qte + ' climatiseurs — ' : ''}${duree} jours — retrait ${dateDebut} — ${point.nom}`.slice(0, 1000),
      metadata: {
        mode: 'click_collect',
        ref, prenom, nom, tel, email,
        adresse: adresseResa.slice(0, 500),
        point_id: point.id, point_nom: point.nom,
        duree: String(duree), quantite: String(qte),
        date: dateDebut, date_fin: dateFin,
        creneau: 'Retrait au point, aux horaires d’ouverture',
        installation: 'Click & Collect (retrait par le client)',
        frais_livraison: '0 EUR',
        customer_id: customerId,
        campagne: clip(data.campagne, 400),
        piece_identite: pi.type || 'apres_paiement',
        lang: data.lang === 'en' || data.lang === 'es' ? data.lang : 'fr',
        prix_fort: unitCents !== prix.normalCents ? `${unitCents > prix.normalCents ? '+' : ''}${Math.round((unitCents / prix.normalCents - 1) * 100)} % (base ${prix.normalCents / 100} €)` : 'non',
        tarif_dynamique: JSON.stringify({ s: prix.signaux, m: prix.multiplicateur, r: prix.raisons, devis: !!garanti }).slice(0, 480),
      },
    }, { idempotencyKey: `cc-${ref}` });

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
      instructions_acces: `CLICK & COLLECT : déposer l'appareil (sans kit de fenêtre : non fourni en Click & Collect) au point « ${point.nom} » (${point.adresse}). Le client vient le chercher le ${dateDebut} et le rapporte au même point. Récupération = reprendre l'appareil au point.`.slice(0, 1000),
      creneau: 'Retrait au point, aux horaires d’ouverture',
      date_debut: dateDebut,
      date_fin: dateFin,
      quantite: qte,
      prix_total_cents: amountCents,
      statut: 'en_attente',
      source: 'site',
      source_channel: 'click_collect',
      lang: data.lang === 'en' || data.lang === 'es' ? data.lang : 'fr',
      type_client: raisonSociale ? 'entreprise' : 'particulier',
      raison_sociale: raisonSociale || null,
      siret: raisonSociale && siretClient ? siretClient : null,
      cgv_accepted_at: new Date().toISOString(),
      piece_identite_paths: chemins.length ? chemins : null,
      point_retrait_id: point.id,
      partenaire_id: partenaireId,
      partenaire_commission_cents: commissionCents,
      adresse_client: adresseClient,
    };
    let { data: resa, error: insertErr } = await supabase.from('reservations').insert(ligne).select('id').single();
    // Colonne adresse_client pas encore créée (migration du 20/11 à passer) :
    // l'adresse part dans les consignes, rien n'est perdu.
    if (insertErr && /adresse_client/.test(insertErr.message || '')) {
      delete ligne.adresse_client;
      ligne.instructions_acces = `${ligne.instructions_acces} | ADRESSE CLIENT : ${adresseClient}`.slice(0, 1000);
      ({ data: resa, error: insertErr } = await supabase.from('reservations').insert(ligne).select('id').single());
    }
    // Colonne piece_identite_paths pas encore créée en base (migration SQL à
    // passer par le propriétaire) : on enregistre quand même la réservation,
    // les chemins de la pièce d'identité partant dans les consignes, pour ne
    // rien perdre. Voir supabase/migration_2026-11-18_click_collect.sql.
    if (insertErr && /piece_identite_paths|point_retrait_id/.test(insertErr.message || '')) {
      delete ligne.piece_identite_paths; delete ligne.point_retrait_id;
      if (chemins.length) ligne.instructions_acces = `${ligne.instructions_acces} | PIÈCE D'IDENTITÉ (${pi.type}) : ${chemins.join(' ; ')}`.slice(0, 1000);
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

    return res.status(200).json({
      clientSecret: intent.client_secret, amountCents, quantite: qte, ref, numero: numeroComptoir(ref), majore: prix.majore,
      // QR de remise : montré au client, scanné par le commerçant au retrait.
      remise: { lien: lienRemise(resa.id, ref), qr: imageQrRemise(resa.id, ref) },
      // Pour ajouter la pièce d'identité juste après le paiement.
      identite: chemins.length ? null : { id: resa.id, code: codeIdentite(resa.id, ref) },
    });
  } catch (err) {
    console.error('[CC Stripe]', err.message);
    await recordFailedAttempt(supabase, `checkout:${ip}`).catch(() => {});
    return res.status(500).json({ error: 'Erreur serveur paiement.' });
  }
};
