const Stripe = require('stripe');
const { getSupabase }     = require('./_lib/supabase');
const { resolveCityById } = require('./_lib/city');
const { getAvailability } = require('./_lib/stock');
const { isValidDate }     = require('./_lib/dates');

function calcBase(days) {
  days = Math.max(1, days);
  if (days <= 7)  return days * 20;
  if (days <= 14) return 7 * 20 + (days - 7) * 18;
  if (days <= 21) return 7 * 20 + 7 * 18 + (days - 14) * 17;
  return 7 * 20 + 7 * 18 + 7 * 17 + (days - 21) * 16;
}

function diffDays(startStr, endStr) {
  return Math.round(
    (new Date(endStr + 'T00:00:00Z') - new Date(startStr + 'T00:00:00Z')) / 86400000
  );
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, ref, new_date_fin } = req.body || {};

  if (!email || !new_date_fin) {
    return res.status(400).json({ error: 'Email et nouvelle date de fin requis' });
  }
  if (!isValidDate(new_date_fin)) {
    return res.status(400).json({ error: 'Date invalide' });
  }

  const supabase = getSupabase();
  const stripe   = new Stripe(process.env.STRIPE_SECRET_KEY);

  // Retrouver la réservation d'origine par email (+ ref si fournie)
  let q = supabase
    .from('reservations')
    .select('id, ref, prenom, nom, tel, adresse, city_id, date_debut, date_fin, quantite, statut, stripe_customer_id, tel_secondaire')
    .eq('email', String(email).trim().toLowerCase())
    .not('source', 'eq', 'site_prolongation')
    .order('created_at', { ascending: false })
    .limit(1);

  if (ref && ref.trim()) {
    q = supabase
      .from('reservations')
      .select('id, ref, prenom, nom, tel, adresse, city_id, date_debut, date_fin, quantite, statut, stripe_customer_id, tel_secondaire')
      .eq('email', String(email).trim().toLowerCase())
      .ilike('ref', ref.trim().toUpperCase())
      .not('source', 'eq', 'site_prolongation')
      .order('created_at', { ascending: false })
      .limit(1);
  }

  const { data: orig, error: lookupErr } = await q.maybeSingle();

  if (lookupErr) {
    console.error('[prolong-pay lookup]', lookupErr.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
  if (!orig) {
    return res.status(404).json({ error: 'Réservation introuvable.' });
  }
  if (['annulee', 'remboursee'].includes(orig.statut)) {
    return res.status(422).json({ error: 'Cette location ne peut pas être prolongée.' });
  }
  if (new_date_fin <= orig.date_fin) {
    return res.status(400).json({ error: `La nouvelle date doit être postérieure au ${orig.date_fin}.` });
  }

  const origDays  = diffDays(orig.date_debut, orig.date_fin);
  const totalDays = diffDays(orig.date_debut, new_date_fin);
  const jours     = totalDays - origDays;

  if (jours < 1) {
    return res.status(400).json({ error: 'Durée minimale : 1 jour.' });
  }

  const amountCents = (calcBase(totalDays) - calcBase(origDays)) * (orig.quantite || 1) * 100;

  if (!amountCents || amountCents < 1900) {
    return res.status(400).json({ error: 'Montant invalide' });
  }

  // Vérification des disponibilités sur la période d'extension
  let city;
  try {
    city = await resolveCityById(supabase, orig.city_id);
    if (!city) return res.status(422).json({ error: 'Zone introuvable — contactez-nous directement.' });

    const disponibles = await getAvailability(supabase, city.id, orig.date_fin, new_date_fin);
    if (disponibles < (orig.quantite || 1)) {
      return res.status(409).json({ error: 'Plus assez de climatiseurs disponibles pour cette prolongation.', disponibles: Math.max(0, disponibles) });
    }
  } catch (err) {
    console.error('[prolong-pay stock]', err.message);
    return res.status(500).json({ error: 'Erreur serveur stock' });
  }

  const dateFinDisplay = new Date(new_date_fin + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  try {
    let customerId = orig.stripe_customer_id || '';
    if (!customerId) {
      const existing = await stripe.customers.list({ email: String(email).trim(), limit: 1 });
      customerId = existing.data.length > 0 ? existing.data[0].id : '';
    }

    const intent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      setup_future_usage: 'off_session',
      customer:      customerId || undefined,
      receipt_email: String(email).trim(),
      description:   `Loc'Air Prolongation — +${jours}j jusqu'au ${dateFinDisplay} · ${orig.ref || ''}`,
      metadata: {
        type:              'prolongation',
        prenom:            (orig.prenom  || '').slice(0, 500),
        nom:               (orig.nom     || '').slice(0, 500),
        tel:               (orig.tel     || '').slice(0, 500),
        adresse_origine:   (orig.adresse || '').slice(0, 500),
        ref_origine:       (orig.ref     || '').slice(0, 500),
        jours:             String(jours),
        original_days:     String(origDays),
        total_days:        String(totalDays),
        date_debut:        orig.date_debut,
        date_fin_initiale: orig.date_fin,
        date_recuperation: new_date_fin,
        customer_id:       customerId,
      },
    });

    const { error: insertErr } = await supabase.from('reservations').insert({
      city_id:                  orig.city_id,
      ref:                      `PROLONG-${intent.id.slice(-8)}`,
      stripe_payment_intent_id: intent.id,
      stripe_customer_id:       customerId || null,
      prenom:                   (orig.prenom  || '').slice(0, 200),
      nom:                      (orig.nom     || '').slice(0, 200),
      email:                    String(email).trim().slice(0, 200),
      tel:                      (orig.tel     || '').slice(0, 50),
      tel_secondaire:           orig.tel_secondaire || null,
      adresse:                  (orig.adresse || '').slice(0, 500),
      date_debut:               orig.date_fin,
      date_fin:                 new_date_fin,
      quantite:                 orig.quantite || 1,
      prix_total_cents:         amountCents,
      statut:                   'en_attente',
      source:                   'site_prolongation',
    });

    if (insertErr) {
      console.error('[prolong-pay insert]', insertErr.message);
      await stripe.paymentIntents.cancel(intent.id).catch(e => console.error('[Stripe cancel]', e.message));
      return res.status(500).json({ error: 'Erreur serveur réservation' });
    }

    return res.status(200).json({
      clientSecret: intent.client_secret,
      amountCents,
      jours,
      newDateFin: new_date_fin,
    });
  } catch (err) {
    console.error('[prolong-pay stripe]', err.message);
    return res.status(500).json({ error: 'Erreur serveur paiement' });
  }
};
