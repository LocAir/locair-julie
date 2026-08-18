const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');
const { resolveAdminCity } = require('./_lib/city');
const { generateFacturePdf } = require('./_lib/pdf');
const { getPricingConfig } = require('./_lib/pricing');
const { extractPostalCode } = require('./_lib/postal');
const { isValidDate } = require('./_lib/dates');

// Aperçu de facture depuis le formulaire "Nouvelle réservation" (demande
// d'Aly, 2026-08-17) : vérifier le rendu et le détail des montants AVANT de
// créer réellement la réservation — ne crée ni ne sauvegarde rien (pas de
// ligne "documents", numéro affiché "APERÇU"). Réutilise generateFacturePdf
// tel quel : un écart entre le sous-total recalculé et le prix saisi (ex.
// prix modifié à la main dans le formulaire) apparaît en "Ajustement/Remise
// commerciale", exactement comme sur une vraie facture.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });
  if (!roleHasAccess(admin.role, 'commandes')) return res.status(403).json({ error: "Ton compte n'a pas accès aux réservations." });

  const body = req.body || {};
  try {
    const city = await resolveAdminCity(supabase, body);
    if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });

    const dateDebut = (body.date_debut || '').slice(0, 10);
    const dateFin   = (body.date_fin   || '').slice(0, 10);
    if (!isValidDate(dateDebut) || !isValidDate(dateFin) || dateFin <= dateDebut) {
      return res.status(400).json({ error: 'Dates invalides' });
    }

    // Même détection hors zone que la vraie création (admin-reservations.js,
    // action 'create') — pour que l'aperçu affiche le bon tarif de livraison.
    const adresse = (body.adresse || '').trim();
    const cpAdresse = (body.code_postal || '').trim() || extractPostalCode(adresse);
    const horsZone = !(cpAdresse && Array.isArray(city.postal_codes) && city.postal_codes.includes(cpAdresse));

    const reservation = {
      ref: 'APERÇU',
      prenom: (body.prenom || '').trim() || 'Client',
      nom: (body.nom || '').trim(),
      adresse: adresse || '—',
      email: (body.email || '').trim(),
      type_client: body.type_client === 'entreprise' ? 'entreprise' : 'particulier',
      raison_sociale: (body.raison_sociale || '').trim(),
      siret: (body.siret || '').trim(),
      date_debut: dateDebut, date_fin: dateFin,
      quantite: Math.min(5, Math.max(1, parseInt(body.quantite) || 1)),
      installation: (body.installation || '').trim(),
      hors_zone: horsZone,
      express: Boolean(body.express),
      prix_total_cents: Math.max(0, parseInt(body.prix_total_cents) || 0),
      stripe_payment_intent_id: null,
    };

    const pricing = await getPricingConfig(supabase);
    const buffer = await generateFacturePdf({ reservation, appareils: [], numero: 'APERÇU', datePaiement: new Date(), pricing });
    return res.status(200).json({ ok: true, pdf_base64: buffer.toString('base64') });
  } catch (err) {
    console.error('[Admin facture preview]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
