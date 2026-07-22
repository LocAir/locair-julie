const Stripe = require('stripe');
const { getSupabase }     = require('./_lib/supabase');
const { resolveCityById } = require('./_lib/city');
const { getAvailability } = require('./_lib/stock');
const { isValidDate }     = require('./_lib/dates');
const { calcTieredPrice } = require('./_lib/pricing');
const { CGV_VERSION, ACCEPTANCE_TYPES } = require('./_lib/legal');

const calcBase = calcTieredPrice;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const data   = req.body || {};
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // Même contrôle serveur que /api/checkout — le bouton de paiement est déjà
  // désactivé côté site tant que la case CGV n'est pas cochée, mais ça ne
  // protège que l'UI.
  if (data.cgv_accepted !== true) {
    return res.status(400).json({ error: 'Vous devez accepter les CGV avant de payer.' });
  }

  const jours          = Math.max(1, parseInt(data.jours) || 1);
  const clientOrigDays = Math.max(0, parseInt(data.original_days) || 0);
  const qty            = Math.min(5, Math.max(1, parseInt(data.quantite) || 1));

  // Prix calculé avec l'origDays du client pour l'instant — recalculé ci-dessous
  // à partir des dates réelles en DB pour empêcher toute manipulation du prix.
  let amountCents = Math.max(0, clientOrigDays > 0
    ? calcBase(clientOrigDays + jours) - calcBase(clientOrigDays)
    : calcBase(jours)) * qty * 100;
  const extDateDebut   = (data.date_fin_initiale     || '').slice(0, 10);
  const extDateFin     = (data.date_recuperation_iso || '').slice(0, 10);
  if (!isValidDate(extDateDebut) || !isValidDate(extDateFin) || extDateFin <= extDateDebut) {
    return res.status(400).json({ error: 'Dates de prolongation invalides' });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (extDateDebut < today) {
    return res.status(422).json({ error: 'La date de fin initiale est déjà passée — impossible de prolonger.' });
  }

  const supabase = getSupabase();
  let city;
  let orig; // récupérée dans le 1er bloc try, réutilisée dans le 2e (insert) plus bas
  try {
    // Une prolongation ne collecte pas une nouvelle adresse — on reprend la
    // même zone que la réservation d'origine du client, retrouvée par email
    // (pas par adresse : plus fiable, et cohérent avec la logique de
    // rattachement déjà utilisée dans confirmReservation). Si un numéro de
    // commande est fourni (ex. lien depuis l'email "avant fin de location"),
    // il précise la recherche — utile si le client a plusieurs réservations
    // passées avec la même adresse email.
    if (!data.email) {
      return res.status(400).json({ error: 'Email requis pour retrouver ta réservation' });
    }
    let origQuery = supabase
      .from('reservations').select('city_id, tel_secondaire, hors_zone, date_debut, date_fin')
      .ilike('email', String(data.email).trim());
    if (data.ref) origQuery = origQuery.eq('ref', String(data.ref).trim());
    ({ data: orig } = await origQuery.order('created_at', { ascending: false }).limit(1).maybeSingle());
    city = orig ? await resolveCityById(supabase, orig.city_id) : null;
    if (!city) {
      return res.status(422).json({ error: 'Réservation d\'origine introuvable — contacte-nous directement pour prolonger.' });
    }
    // Recalcul du montant avec les dates réelles pour empêcher la manipulation de origDays
    if (orig?.date_debut && orig?.date_fin) {
      const dbOrigDays = Math.round((new Date(orig.date_fin) - new Date(orig.date_debut)) / 86400000);
      if (dbOrigDays > 0) {
        amountCents = Math.max(0, calcBase(dbOrigDays + jours) - calcBase(dbOrigDays)) * qty * 100;
      }
    }
    if (!amountCents || amountCents <= 0) {
      return res.status(400).json({ error: 'Montant invalide' });
    }
    const disponibles = await getAvailability(supabase, city.id, extDateDebut, extDateFin);
    if (disponibles < qty) {
      return res.status(409).json({ error: 'Plus assez de climatiseurs disponibles pour cette prolongation', disponibles: Math.max(0, disponibles) });
    }
  } catch (err) {
    console.error('[Stock check prolong]', err.message);
    return res.status(500).json({ error: 'Erreur serveur stock' });
  }

  try {
    let customerId = '';
    if (data.email) {
      const email = data.email.trim();
      const existing = await stripe.customers.list({ email, limit: 1 });
      if (existing.data.length > 0) {
        customerId = existing.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email,
          name:  [data.prenom, data.nom].filter(Boolean).join(' ') || undefined,
          phone: data.tel || undefined,
        });
        customerId = customer.id;
      }
    }

    const intent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      setup_future_usage: 'off_session',
      customer:      customerId || undefined,
      receipt_email: data.email || undefined,
      description: [
        `Loc'Air Prolongation — ${jours} jour${jours > 1 ? 's' : ''}`,
        clientOrigDays > 0 ? `(total ${clientOrigDays + jours}j)` : '',
        data.prenom ? `${data.prenom} ${data.nom || ''}`.trim() : '',
        data.date_recuperation ? `Récup. ${data.date_recuperation}` : '',
      ].filter(Boolean).join(' · ').slice(0, 1000),
      metadata: {
        type:              'prolongation',
        prenom:            (data.prenom            || '').slice(0, 500),
        nom:               (data.nom               || '').slice(0, 500),
        tel:               (data.tel               || '').slice(0, 500),
        adresse_origine:   (data.adresse_origine   || '').slice(0, 500),
        ref:               (data.ref               || '').slice(0, 500),
        jours:             String(jours),
        quantite:          String(qty),
        original_days:     String(clientOrigDays),
        total_days:        String(clientOrigDays + jours),
        date_debut:        (data.date_debut        || '').slice(0, 500),
        date_fin_initiale: (data.date_fin_initiale || '').slice(0, 500),
        date_recuperation: (data.date_recuperation || '').slice(0, 500),
        creneau:           (data.creneau           || '').slice(0, 500),
        customer_id:       customerId,
        lang:              ['fr','en','zh'].includes(data.lang) ? data.lang : 'fr',
      },
    });

    const { data: insertedResa, error: insertErr } = await supabase.from('reservations').insert({
      city_id:                  city.id,
      ref:                      `PROLONG-${intent.id.slice(-8)}`,
      stripe_payment_intent_id: intent.id,
      stripe_customer_id:       customerId || null,
      prenom:                   (data.prenom          || '').slice(0, 200),
      nom:                      (data.nom             || '').slice(0, 200),
      // En minuscules, comme checkout.js — sans ça le rattachement à la
      // réservation d'origine (confirmReservation, recherche par email) peut
      // rater si la casse tapée diffère d'une fois sur l'autre.
      email:                    (data.email           || '').trim().toLowerCase().slice(0, 200),
      tel:                      (data.tel             || '').slice(0, 50),
      tel_secondaire:           orig?.tel_secondaire || null,
      // Reprend le statut hors zone de la réservation d'origine — sinon le
      // transporteur touche le tarif normal pour une récupération hors zone.
      hors_zone:                orig?.hors_zone || false,
      adresse:                  (data.adresse_origine || '').slice(0, 500),
      creneau:                  (data.creneau         || '').slice(0, 500),
      date_debut:               extDateDebut,
      date_fin:                 extDateFin,
      quantite:                 qty,
      prix_total_cents:         amountCents,
      statut:                   'en_attente',
      source:                   'site_prolongation',
      lang:                     ['fr','en','zh'].includes(data.lang) ? data.lang : 'fr',
    }).select('id').single();

    if (insertErr) {
      console.error('[Reservation prolong insert]', insertErr.message);
      await stripe.paymentIntents.cancel(intent.id).catch(e => console.error('[Stripe cancel]', e.message));
      return res.status(500).json({ error: 'Erreur serveur réservation' });
    }

    try {
      await supabase.from('cgv_acceptations').insert({
        reservation_id: insertedResa.id,
        type:           ACCEPTANCE_TYPES.CGV_LOCATION,
        version:        CGV_VERSION,
        accepted_at:    data.cgv_accepted_at || new Date().toISOString(),
      });
    } catch (e) {
      console.error('[CGV acceptations prolong]', e.message);
    }

    return res.status(200).json({ clientSecret: intent.client_secret, amountCents });
  } catch (err) {
    console.error('[Stripe prolong]', err.message);
    return res.status(500).json({ error: 'Erreur serveur paiement' });
  }
};
