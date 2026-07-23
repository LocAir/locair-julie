const { getSupabase } = require('./_lib/supabase');
const { resolveAdminCity } = require('./_lib/city');
const { checkAdminToken } = require('./_lib/auth');
const { getSignature, withSignature, fmtDate } = require('./_lib/emailEngine');
const { sendBrevoEmail } = require('./_lib/brevo');
const { wrap, escHtml } = require('./_lib/emailTemplates');

const STATUTS_VALIDES = ['brouillon', 'envoye', 'accepte', 'refuse', 'expire'];

function fmtEuros(cents) {
  return ((cents || 0) / 100).toFixed(2).replace('.', ',') + ' €';
}

// Devis entreprises (Module 8) — reservations.type_client='entreprise' existe
// déjà mais rien ne permet de chiffrer une demande avant qu'elle s'engage
// (ex. 10 climatiseurs sur 2 mois). Ce module reste volontairement une
// simple fiche de chiffrage + email récap : "Accepté" ne crée jamais de
// réservation ni ne bloque de stock automatiquement — l'admin bascule
// manuellement via le formulaire de création existant une fois l'accord
// obtenu, pour ne pas dupliquer cette logique ici.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    const city = await resolveAdminCity(supabase, body);
    if (!city) return res.status(404).json({ error: 'Aucune ville configurée' });

    if (action === 'list') {
      const { data, error } = await supabase
        .from('devis')
        .select('id, prenom, nom, raison_sociale, siret, email, tel, date_debut, date_fin, quantite, installation, prix_propose_cents, statut, notes, created_at')
        .eq('city_id', city.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return res.status(200).json({ devis: data || [] });
    }

    if (action === 'create') {
      const raisonSociale = (body.raison_sociale || '').trim().slice(0, 200);
      const email = (body.email || '').trim().slice(0, 200);
      const quantite = parseInt(body.quantite) || 1;
      if (!raisonSociale) return res.status(400).json({ error: 'Raison sociale requise' });
      if (!email) return res.status(400).json({ error: 'Email requis' });
      if (quantite <= 0) return res.status(400).json({ error: 'Quantité invalide' });

      const prixCents = parseInt(body.prix_propose_cents);
      const insertRow = {
        city_id: city.id,
        prenom: (body.prenom || '').trim().slice(0, 100) || null,
        nom: (body.nom || '').trim().slice(0, 100) || null,
        raison_sociale: raisonSociale,
        siret: (body.siret || '').trim().slice(0, 20) || null,
        email,
        tel: (body.tel || '').trim().slice(0, 30) || null,
        date_debut: body.date_debut || null,
        date_fin: body.date_fin || null,
        quantite,
        installation: (body.installation || '').trim().slice(0, 100) || null,
        prix_propose_cents: Number.isFinite(prixCents) && prixCents >= 0 ? prixCents : 0,
        statut: 'brouillon',
        notes: (body.notes || '').slice(0, 1000) || null,
      };
      const { data, error } = await supabase.from('devis').insert(insertRow).select().single();
      if (error) throw error;
      return res.status(200).json({ ok: true, devis: data });
    }

    if (action === 'update_statut') {
      const id = parseInt(body.id);
      if (!id || !body.statut) return res.status(400).json({ error: 'Paramètres manquants' });
      if (!STATUTS_VALIDES.includes(body.statut)) return res.status(400).json({ error: 'Statut invalide' });
      const { data: before } = await supabase
        .from('devis').select('id, city_id')
        .eq('id', id).maybeSingle();
      if (!before || before.city_id !== city.id) return res.status(404).json({ error: 'Devis introuvable' });

      const { error } = await supabase.from('devis').update({ statut: body.statut }).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // Envoie un email récapitulatif du chiffrage au contact entreprise —
    // aucun paiement Stripe à ce stade, juste un devis à valider par retour
    // (téléphone/email), comme sendReservationPaymentLink pour une
    // réservation manuelle mais sans lien de paiement.
    if (action === 'send') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'Paramètres manquants' });
      const { data: d } = await supabase
        .from('devis').select('id, city_id, prenom, nom, raison_sociale, email, date_debut, date_fin, quantite, installation, prix_propose_cents')
        .eq('id', id).maybeSingle();
      if (!d || d.city_id !== city.id) return res.status(404).json({ error: 'Devis introuvable' });
      if (!d.email) return res.status(400).json({ error: 'Aucun email sur ce devis' });

      const sig = await getSignature(supabase);
      const bodyHtml = `
        <p>Bonjour${d.prenom ? ' ' + escHtml(d.prenom) : ''},</p>
        <p>Voici le chiffrage établi pour <strong>${escHtml(d.raison_sociale)}</strong> :</p>
        <div class="box">
          <p style="margin:0 0 4px"><strong>${d.quantite} climatiseur${d.quantite > 1 ? 's' : ''}</strong>${d.date_debut && d.date_fin ? ' du ' + escHtml(fmtDate(d.date_debut)) + ' au ' + escHtml(fmtDate(d.date_fin)) : ''}</p>
          ${d.installation ? `<p style="margin:0 0 4px">Installation : ${escHtml(d.installation)}</p>` : ''}
          <p style="margin:8px 0 0;font-size:18px;font-weight:700;color:#1b3a5f">${fmtEuros(d.prix_propose_cents)}</p>
        </div>
        <p>N'hésitez pas à nous contacter pour toute question ou pour valider cette proposition.</p>`;
      const html = withSignature(
        wrap({ title: '📝 Votre devis Loc\'Air', bodyHtml }),
        sig
      );
      const result = await sendBrevoEmail({
        to: d.email, senderName: sig.nom_expediteur,
        subject: `📝 Votre devis Loc'Air — ${d.raison_sociale}`,
        html,
      });
      await supabase.from('email_log').insert({
        reservation_id: null, scenario: 'devis_envoye', canal: 'email',
        destinataire: d.email, modele: 'devis',
        statut: result.ok ? 'envoye' : 'erreur',
        erreur: result.ok ? null : String(result.error || '').slice(0, 500),
        contenu: html,
      }).catch(() => {});
      if (!result.ok) return res.status(500).json({ error: result.error || "Échec de l'envoi" });

      await supabase.from('devis').update({ statut: 'envoye' }).eq('id', id);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin devis]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
