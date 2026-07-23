const { fmtDate, getSignature, withSignature } = require('./emailEngine');
const { sendBrevoEmail } = require('./brevo');
const { tplLienPaiement } = require('./emailTemplates');
const { calcTieredPrice } = require('./pricing');

// Doit rester synchronisé avec INSTALL_FEE dans checkout.js/index.html — même
// remarque que là-bas : un écart ferait afficher un détail différent du tarif
// réel appliqué sur le site.
const INSTALL_FEE_CENTS = 4900;

function fmtEuros(cents) {
  return ((cents || 0) / 100).toFixed(2).replace('.', ',') + ' €';
}

// Détail location/installation/livraison, pour donner au client par email et
// sur la page de paiement Stripe le même récapitulatif que le site (voir
// #recap-box dans index.html : "Location (X jours)" / "Pose technicien ou
// autonome" / "Livraison & récupération"). Le prix total reste celui saisi
// à la main par l'admin au téléphone (peut inclure une remise) — on retrouve
// la part "livraison" par différence plutôt que de la recalculer depuis
// l'adresse (le formulaire manuel ne capture pas de code postal séparé). Si
// ce reste est négatif (le prix saisi est inférieur au tarif de base attendu
// — remise plus importante que la livraison ne peut l'absorber), impossible
// de présenter un détail cohérent : on revient à un montant global simple.
function computeManualBreakdown(resa) {
  const days = Math.max(1, Math.round((new Date(resa.date_fin + 'T00:00:00Z') - new Date(resa.date_debut + 'T00:00:00Z')) / 86400000));
  const qty = Math.max(1, resa.quantite || 1);
  const baseCents = Math.round(calcTieredPrice(days) * qty * 100);
  const isTech = (resa.installation || '').startsWith('Technicien');
  const installCents = isTech ? INSTALL_FEE_CENTS : 0;
  const livraisonCents = (resa.prix_total_cents || 0) - baseCents - installCents;
  if (livraisonCents < 0) return null;
  return { days, qty, baseCents, installCents, livraisonCents, isTech };
}

// Lien de paiement Stripe pour une réservation manuelle "en attente" (prise
// par téléphone, client pas présent pour payer tout de suite) — ou relance
// automatique d'une réservation restée en_attente trop longtemps (cron-daily,
// voir options.rappel). Crée une session Stripe Checkout hébergée — aucune
// page à construire côté site, le client paie directement sur la page
// Stripe — puis relie son PaymentIntent à la réservation déjà créée
// (stripe_payment_intent_id) : c'est ce même champ que le webhook Stripe
// (webhook.js) utilise pour retrouver et confirmer une réservation payée sur
// le site, donc dès que le client paie, exactement le même circuit se
// déclenche ici (missions créées, contrat/facture, email de confirmation) —
// sans rien dupliquer. setup_future_usage crée aussi une carte enregistrable
// pour le prélèvement automatique en cas de retard de restitution (voir
// charge-retard.js), comme pour une réservation payée sur le site.
//
// options.scenario : identifiant tracé dans email_log (défaut 'lien_paiement'
// pour l'envoi initial admin ; 'relance_paiement' pour les relances
// automatiques du cron, afin de pouvoir les compter/dater séparément).
// options.rappel : bascule le ton de l'email (titre/intro) sur un rappel
// plutôt qu'un "voici votre lien" initial, sans dupliquer le template.
async function sendReservationPaymentLink(supabase, stripe, resa, options = {}) {
  const { scenario = 'lien_paiement', rappel = false } = options;
  if (!resa.email) return { ok: false, error: 'Aucun email sur cette réservation' };
  let html = '';
  try {
    let customerId = resa.stripe_customer_id || '';
    if (!customerId) {
      const existing = await stripe.customers.list({ email: resa.email, limit: 1 });
      if (existing.data.length > 0) {
        customerId = existing.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email: resa.email,
          name:  [resa.prenom, resa.nom].filter(Boolean).join(' ') || undefined,
          phone: resa.tel || undefined,
        });
        customerId = customer.id;
      }
    }

    // Détaillé en plusieurs articles (comme le récapitulatif du site) plutôt
    // qu'un seul montant global — le client voit sur la page de paiement
    // Stripe exactement la même décomposition que sur locair.fr.
    const breakdown = computeManualBreakdown(resa);
    const lineItem = (name, unit_amount) => ({ price_data: { currency: 'eur', unit_amount, product_data: { name } }, quantity: 1 });
    const line_items = breakdown ? [
      lineItem(`Location climatiseur — ${breakdown.days} jour${breakdown.days > 1 ? 's' : ''}${breakdown.qty > 1 ? ' × ' + breakdown.qty : ''}`, breakdown.baseCents),
      ...(breakdown.installCents > 0 ? [lineItem('Installation par un technicien', breakdown.installCents)] : []),
      ...(breakdown.livraisonCents > 0 ? [lineItem('Livraison & récupération', breakdown.livraisonCents)] : []),
    ] : [lineItem(`Loc'Air — Réservation ${resa.ref}`, resa.prix_total_cents)];

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      payment_intent_data: {
        setup_future_usage: 'off_session',
        receipt_email: resa.email,
        description: `Loc'Air — Réservation ${resa.ref}`,
      },
      line_items,
      success_url: 'https://www.locair.fr/?paiement=confirme',
      cancel_url:  'https://www.locair.fr/?paiement=annule',
      // Mêmes clés que checkout.js (site) — c'est ce que lit webhook.js pour
      // la notification Formspree et le SMS de confirmation.
      metadata: {
        ref: resa.ref || '', prenom: resa.prenom || '', nom: resa.nom || '',
        tel: resa.tel || '', adresse: resa.adresse || '',
        date: resa.date_debut || '', creneau: resa.creneau || '',
        installation: resa.installation || '', fenetre: resa.fenetre || '',
        etage: resa.etage || '', ascenseur: resa.ascenseur || '',
        customer_id: customerId,
      },
    });

    await supabase.from('reservations').update({
      stripe_payment_intent_id: session.payment_intent,
      stripe_customer_id: customerId,
    }).eq('id', resa.id);

    const breakdownRows = breakdown ? [
      { label: `Location (${breakdown.days} jour${breakdown.days > 1 ? 's' : ''}${breakdown.qty > 1 ? ' × ' + breakdown.qty + ' climatiseurs' : ''})`, value: fmtEuros(breakdown.baseCents) },
      { label: breakdown.isTech ? 'Installation par un technicien' : 'Installation autonome (kit fourni)', value: breakdown.isTech ? fmtEuros(breakdown.installCents) : 'Inclus' },
      { label: 'Livraison & récupération', value: fmtEuros(breakdown.livraisonCents) },
    ] : null;

    const sig = await getSignature(supabase);
    html = withSignature(tplLienPaiement({
      prenom: resa.prenom, ref: resa.ref, adresse: resa.adresse,
      dateDebutFmt: fmtDate(resa.date_debut), dateFinFmt: fmtDate(resa.date_fin),
      montantFmt: fmtEuros(resa.prix_total_cents),
      breakdown: breakdownRows,
      lienPaiement: session.url,
      rappel,
    }), sig);
    const subject = rappel
      ? `⏰ Il reste un paiement à finaliser — Dossier ${resa.ref}`
      : `💳 Finalisez votre réservation Loc'Air — Dossier ${resa.ref}`;
    const result = await sendBrevoEmail({
      to: resa.email, senderName: sig.nom_expediteur,
      subject,
      html,
    });
    supabase.from('email_log').insert({
      reservation_id: resa.id, scenario, canal: 'email',
      destinataire: resa.email, modele: 'lien_paiement',
      statut: result.ok ? 'envoye' : 'erreur',
      erreur: result.ok ? null : String(result.error || '').slice(0, 500),
      contenu: html,
    }).catch(() => {});
    if (!result.ok) return { ok: false, error: result.error || 'Échec envoi email' };
    return { ok: true };
  } catch (e) {
    console.error('[Lien paiement]', e.message);
    if (html) {
      supabase.from('email_log').insert({
        reservation_id: resa.id, scenario, canal: 'email',
        destinataire: resa.email, modele: 'lien_paiement', statut: 'erreur',
        erreur: String(e.message || e).slice(0, 500), contenu: html,
      }).catch(() => {});
    }
    return { ok: false, error: e.message };
  }
}

module.exports = { INSTALL_FEE_CENTS, fmtEuros, computeManualBreakdown, sendReservationPaymentLink };
