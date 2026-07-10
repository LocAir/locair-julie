const Stripe = require('stripe');
const { getSupabase }     = require('./_lib/supabase');
const { getCity }         = require('./_lib/city');
const { getAvailability } = require('./_lib/stock');
const { isValidDate, addDays } = require('./_lib/dates');

function calcBase(days) {
  days = Math.max(1, days);
  if (days <= 7)  return days * 20;
  if (days <= 14) return 7 * 20 + (days - 7) * 18;
  if (days <= 21) return 7 * 20 + 7 * 18 + (days - 14) * 17;
  return 7 * 20 + 7 * 18 + 7 * 17 + (days - 21) * 16;
}

const PROMO_CODES  = { LOCAIR10: 10, LOCA10: 10 };
const DELIVERY_FEE = 35;
const INSTALL_FEE  = 25;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const data   = req.body || {};
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const duree = Math.max(7, parseInt(data.duree) || 7);
  const qty   = Math.min(5, Math.max(1, parseInt((data.quantite || '1').replace(/[^0-9]/g, '')) || 1));
  const baseCents     = calcBase(duree) * qty * 100;
  const isTech        = (data.installation || '').startsWith('Technicien');
  const installCents  = isTech ? INSTALL_FEE * 100 : 0;
  const promoCode     = (data.parrain_code || '').trim().toUpperCase();
  const promoDiscount = (PROMO_CODES[promoCode] || 0) * 100;
  const amountCents   = Math.max(0, baseCents + installCents + DELIVERY_FEE * 100 - promoDiscount);

  if (!amountCents || amountCents < 10000) {
    return res.status(400).json({ error: 'Montant invalide' });
  }

  const dateDebut = (data.date || '').slice(0, 10);
  if (!isValidDate(dateDebut)) {
    return res.status(400).json({ error: 'Date de livraison invalide' });
  }
  const dateFin  = addDays(dateDebut, duree);
  const supabase = getSupabase();
  let city;

  try {
    city = await getCity(supabase);
    const disponibles = await getAvailability(supabase, city.id, dateDebut, dateFin);
    if (disponibles < qty) {
      return res.status(409).json({ error: 'Plus assez de climatiseurs disponibles pour ces dates', disponibles: Math.max(0, disponibles) });
    }
  } catch (err) {
    console.error('[Stock check checkout]', err.message);
    return res.status(500).json({ error: 'Erreur serveur stock' });
  }

  try {
    // Créer ou retrouver le Customer Stripe — nécessaire pour l'autorisation de prélèvement
    // off-session en cas de retard de restitution (empreinte carte, sans blocage de fonds)
    let customerId = '';
    if (data.email) {
      const email = data.email.trim();
      const existing = await stripe.customers.list({ email, limit: 1 });
      if (existing.data.length > 0) {
        customerId = existing.data[0].id;
        const c = existing.data[0];
        if (!c.name && (data.prenom || data.nom)) {
          await stripe.customers.update(customerId, {
            name:  [data.prenom, data.nom].filter(Boolean).join(' '),
            phone: data.tel || c.phone || undefined,
          });
        }
      } else {
        const customer = await stripe.customers.create({
          email,
          name:  [data.prenom, data.nom].filter(Boolean).join(' ') || undefined,
          phone: data.tel || undefined,
          metadata: { adresse: (data.adresse || '').slice(0, 500) },
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
        `Loc'Air — ${qty > 1 ? qty + 'x ' : ''}${duree} jour${duree > 1 ? 's' : ''}`,
        data.date              ? `Livraison ${data.date}` : '',
        data.creneau_livraison || '',
        data.adresse           || '',
      ].filter(Boolean).join(' · ').slice(0, 1000),
      metadata: {
        ref:          (data._ref              || '').slice(0, 500),
        prenom:       (data.prenom            || '').slice(0, 500),
        nom:          (data.nom               || '').slice(0, 500),
        tel:          (data.tel               || '').slice(0, 500),
        adresse:      (data.adresse           || '').slice(0, 500),
        duree:        String(duree),
        quantite:     String(qty),
        date:         (data.date              || '').slice(0, 500),
        creneau:      (data.creneau_livraison || '').slice(0, 500),
        installation: (data.installation      || '').slice(0, 500),
        fenetre:      (data.fenetre           || '').slice(0, 500),
        etage:        (data.etage             || '').slice(0, 500),
        ascenseur:    (data.ascenseur         || '').slice(0, 500),
        promo:        promoCode,
        customer_id:  customerId,
      },
    });

    const { error: insertErr } = await supabase.from('reservations').insert({
      city_id:                  city.id,
      ref:                      (data._ref || '').slice(0, 100),
      stripe_payment_intent_id: intent.id,
      stripe_customer_id:       customerId || null,
      prenom:                   (data.prenom  || '').slice(0, 200),
      nom:                      (data.nom     || '').slice(0, 200),
      email:                    (data.email   || '').slice(0, 200),
      tel:                      (data.tel     || '').slice(0, 50),
      adresse:                  (data.adresse || '').slice(0, 500),
      etage:                    (data.etage        || '').slice(0, 50),
      ascenseur:                (data.ascenseur    || '').slice(0, 50),
      fenetre:                  (data.fenetre      || '').slice(0, 100),
      installation:             (data.installation || '').slice(0, 100),
      instructions_acces:       (data.instructions_acces || '').slice(0, 1000),
      creneau:                  (data.creneau_livraison || '').slice(0, 500),
      date_debut:               dateDebut,
      date_fin:                 dateFin,
      quantite:                 qty,
      prix_total_cents:         amountCents,
      statut:                   'en_attente',
      source:                   'site',
    });

    if (insertErr) {
      console.error('[Reservation insert]', insertErr.message);
      await stripe.paymentIntents.cancel(intent.id).catch(e => console.error('[Stripe cancel]', e.message));
      return res.status(500).json({ error: 'Erreur serveur réservation' });
    }

    return res.status(200).json({ clientSecret: intent.client_secret, amountCents, customerId });
  } catch (err) {
    console.error('[Stripe intent]', err.message);
    return res.status(500).json({ error: 'Erreur serveur paiement' });
  }
};
