const Stripe = require('stripe');
const { getSupabase }     = require('./_lib/supabase');
const { getCity }         = require('./_lib/city');
const { getAvailability } = require('./_lib/stock');
const { isValidDate }     = require('./_lib/dates');

function calcBase(days) {
  days = Math.max(1, days);
  if (days <= 7)  return days * 20;
  if (days <= 14) return 7 * 20 + (days - 7) * 18;
  if (days <= 21) return 7 * 20 + 7 * 18 + (days - 14) * 17;
  return 7 * 20 + 7 * 18 + 7 * 17 + (days - 21) * 16;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const data   = req.body || {};
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const jours    = Math.max(1, parseInt(data.jours) || 1);
  const origDays = Math.max(0, parseInt(data.original_days) || 0);

  // Incremental pricing: charge only the difference between (origDays+jours) and origDays
  // so that tier transitions are priced correctly (e.g. 7→16 days = calcBase(16)−calcBase(7))
  const totalBase  = origDays > 0
    ? calcBase(origDays + jours) - calcBase(origDays)
    : calcBase(jours);
  const amountCents = totalBase * 100;

  if (!amountCents || amountCents < 1900) {
    return res.status(400).json({ error: 'Montant invalide (min 1 jour)' });
  }

  const qty            = Math.min(5, Math.max(1, parseInt(data.quantite) || 1));
  const extDateDebut   = (data.date_fin_initiale     || '').slice(0, 10);
  const extDateFin     = (data.date_recuperation_iso || '').slice(0, 10);
  if (!isValidDate(extDateDebut) || !isValidDate(extDateFin) || extDateFin <= extDateDebut) {
    return res.status(400).json({ error: 'Dates de prolongation invalides' });
  }

  const supabase = getSupabase();
  let city;
  try {
    city = await getCity(supabase);
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
        origDays > 0 ? `(total ${origDays + jours}j)` : '',
        data.prenom ? `${data.prenom} ${data.nom || ''}`.trim() : '',
        data.date_recuperation ? `Récup. ${data.date_recuperation}` : '',
      ].filter(Boolean).join(' · ').slice(0, 1000),
      metadata: {
        type:              'prolongation',
        prenom:            (data.prenom            || '').slice(0, 500),
        nom:               (data.nom               || '').slice(0, 500),
        tel:               (data.tel               || '').slice(0, 500),
        adresse_origine:   (data.adresse_origine   || '').slice(0, 500),
        jours:             String(jours),
        original_days:     String(origDays),
        total_days:        String(origDays + jours),
        date_debut:        (data.date_debut        || '').slice(0, 500),
        date_fin_initiale: (data.date_fin_initiale || '').slice(0, 500),
        date_recuperation: (data.date_recuperation || '').slice(0, 500),
        creneau:           (data.creneau           || '').slice(0, 500),
        customer_id:       customerId,
      },
    });

    const { error: insertErr } = await supabase.from('reservations').insert({
      city_id:                  city.id,
      ref:                      `PROLONG-${intent.id.slice(-8)}`,
      stripe_payment_intent_id: intent.id,
      stripe_customer_id:       customerId || null,
      prenom:                   (data.prenom          || '').slice(0, 200),
      nom:                      (data.nom             || '').slice(0, 200),
      email:                    (data.email           || '').slice(0, 200),
      tel:                      (data.tel             || '').slice(0, 50),
      adresse:                  (data.adresse_origine || '').slice(0, 500),
      date_debut:               extDateDebut,
      date_fin:                 extDateFin,
      quantite:                 qty,
      prix_total_cents:         amountCents,
      statut:                   'en_attente',
      source:                   'site_prolongation',
    });

    if (insertErr) {
      console.error('[Reservation prolong insert]', insertErr.message);
      await stripe.paymentIntents.cancel(intent.id).catch(e => console.error('[Stripe cancel]', e.message));
      return res.status(500).json({ error: 'Erreur serveur réservation' });
    }

    return res.status(200).json({ clientSecret: intent.client_secret, amountCents });
  } catch (err) {
    console.error('[Stripe prolong]', err.message);
    return res.status(500).json({ error: 'Erreur serveur paiement' });
  }
};
