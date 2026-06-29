const Stripe = require('stripe');

// Re-fetch depuis Stripe pour confirmer le paiement (évite le problème raw-body sur Vercel)
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const body   = req.body || {};

  try {
    const eventType = body.type || '';
    const obj       = body?.data?.object || {};

    let meta   = null;
    let amount = null;
    let email  = null;

    if (eventType === 'payment_intent.succeeded') {
      // Re-fetch pour confirmer
      const intent = await stripe.paymentIntents.retrieve(obj.id || '');
      if (intent.status !== 'succeeded') return res.json({ received: true, skipped: 'not succeeded' });
      meta   = intent.metadata || {};
      amount = (intent.amount / 100).toFixed(2) + ' €';
      email  = intent.receipt_email || '';

    } else if (eventType === 'checkout.session.completed') {
      const session = await stripe.checkout.sessions.retrieve(obj.id || '');
      if (session.payment_status !== 'paid') return res.json({ received: true, skipped: 'not paid' });
      meta   = session.metadata || {};
      amount = (session.amount_total / 100).toFixed(2) + ' €';
      email  = session.customer_email || '';

    } else {
      return res.json({ received: true, skipped: eventType });
    }

    // Notifier l'opérateur via Formspree
    await fetch('https://formspree.io/f/mvzyngoy', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        _subject:       `✅ PAIEMENT — ${meta.ref || obj.id} — ${meta.prenom || ''} ${meta.nom || ''}`,
        _replyto:       email,
        statut:         `✅ Stripe confirmé — ${amount}`,
        stripe_id:      obj.id || '',
        ref:            meta.ref          || '',
        prenom:         meta.prenom       || '',
        nom:            meta.nom          || '',
        tel:            meta.tel          || '',
        email:          email,
        adresse:        meta.adresse      || '',
        duree:          meta.duree        || '',
        date_livraison: meta.date         || '',
        creneau:        meta.creneau      || '',
        installation:   meta.installation || '',
        fenetre:        meta.fenetre      || '',
        etage:          meta.etage        || '',
        ascenseur:      meta.ascenseur    || '',
      }),
    });

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Stripe webhook]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
