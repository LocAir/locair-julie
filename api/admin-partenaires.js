const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { checkAdminRole } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');
const { sendBrevoEmail } = require('./_lib/brevo');
const { tplAmbassadeurCredentials } = require('./_lib/emailTemplates');
const { getSignature, withSignature } = require('./_lib/emailEngine');
const { hashPin } = require('./_lib/pinHash');
const { detecterParrainage } = require('./_lib/parrainage');

function partenaireLinkFor(code) { return `https://www.locair.fr/?p=${encodeURIComponent(code)}`; }

// Envoyée à la création ET à chaque changement de code personnel (admin ou
// "code oublié" côté ambassadeur) — évite à l'admin de devoir retransmettre le
// lien/code lui-même à chaque fois (jusqu'ici copié-collé à la main depuis la
// popup de l'admin). Ne fait jamais échouer l'appelant si l'envoi rate. Même
// gabarit (en-tête + signature du service client) que les emails clients —
// voir _lib/emailTemplates.js.
async function notifyPartenaireCredentials(supabase, { nom, email, code, pin }) {
  if (!email) return;
  const sig  = await getSignature(supabase);
  const html = withSignature(tplAmbassadeurCredentials({ nom, lien: partenaireLinkFor(code), pin }), sig);

  const result = await sendBrevoEmail({ to: email, subject: "Ton espace ambassadeur Loc'Air", html, senderName: sig.nom_expediteur, replyTo: 'partenaires.locair@outlook.com' });
  // Pas de reservation_id pour un email ambassadeur (email_log est structuré
  // autour des réservations) — reservation_id:null reste consultable en base
  // même sans apparaître dans le panneau Communications admin, qui ne liste
  // que les emails rattachés à une réservation. Jusqu'ici cet envoi n'était
  // ni vérifié ni tracé nulle part (audit communications, juillet 2026).
  if (!result.ok) console.error('[Email ambassadeur]', result.error);
  await supabase.from('email_log').insert({
    reservation_id: null, scenario: 'email_bienvenue_ambassadeur', canal: 'email',
    destinataire: email, modele: 'email_bienvenue_ambassadeur',
    statut: result.ok ? 'envoye' : 'erreur',
    erreur: result.ok ? null : String(result.error || '').slice(0, 500),
    contenu: html,
  }).then(() => {}, () => {});
}

// Dérive un code d'affiliation lisible à partir du nom ("Conciergerie Azur"
// → "conciergerieazur") — pas de garantie d'unicité ici, gérée par la boucle
// d'insertion ci-dessous (même logique que le PIN transporteur généré
// automatiquement dans admin-transporteurs.js).
function slugifyNom(nom) {
  return (nom || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 16) || 'partenaire';
}

// IBAN/BIC stockés sans espaces (format le plus utile pour les réutiliser
// plus tard avec une vraie API de virement) — affichés avec des espaces
// uniquement côté admin/index.html.
function normalizeIban(v) { return (v || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 34) || null; }
function normalizeBic(v)  { return (v || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 11) || null; }

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const supabase = getSupabase();
  const admin = await checkAdminRole(req, supabase);
  if (!admin.ok) return res.status(401).json({ error: 'Non autorisé' });
  if (!roleHasAccess(admin.role, 'partenaires')) return res.status(403).json({ error: "Ton compte n'a pas accès aux partenaires." });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    if (action === 'list') {
      const { data, error } = await supabase.from('partenaires').select('*').order('nom');
      if (error) throw error;
      return res.status(200).json({
        partenaires: (data || []).map(p => { const { pin: _pin, iban: _iban, bic: _bic, titulaire_compte: _tc, ...safeP } = p; return safeP; }),
      });
    }

    if (action === 'detail') {
      if (!roleHasAccess(admin.role, 'finances')) return res.status(403).json({ error: "Ton compte n'a pas accès aux coordonnées bancaires." });
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { data, error } = await supabase.from('partenaires').select('id, nom, titulaire_compte, iban, bic').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Partenaire introuvable' });
      return res.status(200).json({ partenaire: data });
    }

    if (action === 'create') {
      const nom = String(body.nom || '').trim();
      if (!nom) return res.status(400).json({ error: 'Nom requis' });
      const taux = Math.min(100, Math.max(0, parseInt(body.taux_commission_pct) || 10));
      const codeDemande = String(body.code || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const base = codeDemande || slugifyNom(nom);
      const pinProvided = String(body.pin || '').trim();
      // Code secret choisi à la main : 4 à 8 chiffres (sinon trop facile à deviner).
      if (pinProvided && !/^\d{4,8}$/.test(pinProvided)) return res.status(400).json({ error: 'Le code secret doit faire 4 à 8 chiffres.' });

      for (let attempt = 0; attempt < 5; attempt++) {
        const code     = attempt === 0 ? base : `${base}${crypto.randomInt(10, 100)}`;
        const pinPlain = pinProvided || String(crypto.randomInt(100000, 1000000));
        const { data: created, error } = await supabase.from('partenaires').insert({
          nom,
          contact_nom:         String(body.contact_nom || '').trim() || null,
          email:               String(body.email || '').trim().toLowerCase() || null,
          telephone:           String(body.telephone || '').trim() || null,
          code,
          pin:        hashPin(pinPlain),
          pin_hashed: true,
          taux_commission_pct: taux,
          titulaire_compte:    String(body.titulaire_compte || '').trim() || null,
          iban:                normalizeIban(body.iban),
          bic:                 normalizeBic(body.bic),
        }).select('id, code').single();
        if (!error) {
          await notifyPartenaireCredentials(supabase, { nom, email: String(body.email || '').trim().toLowerCase(), code: created.code, pin: pinPlain });
          // Fiche créée : un parrainage en attente lui correspond ? (même
          // téléphone ou même commerce) → signé + notifications.
          const parrainage = await detecterParrainage(supabase, { id: created.id, nom, telephone: body.telephone });
          return res.status(200).json({ ok: true, code: created.code, pin: pinPlain, parrainage });
        }
        if (error.code !== '23505') throw error;
        // Code choisi à la main (ex. celui de son point de retrait) déjà pris :
        // on ne le change pas en silence, sinon le commerçant n'est plus relié
        // à son point (ni commission, ni code retour dans son espace).
        if (codeDemande) return res.status(409).json({ error: `Le code « ${codeDemande} » est déjà utilisé par un autre partenaire.` });
      }
      return res.status(500).json({ error: 'Impossible de générer un code unique, réessaie' });
    }

    if (action === 'update') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const patch = {};
      if (body.nom != null)         patch.nom         = String(body.nom).trim();
      if (body.contact_nom != null) patch.contact_nom = String(body.contact_nom).trim() || null;
      if (body.email != null)       patch.email       = String(body.email).trim().toLowerCase() || null;
      if (body.telephone != null)   patch.telephone   = String(body.telephone).trim() || null;
      if (body.actif != null)       patch.actif       = Boolean(body.actif);
      if (body.taux_commission_pct != null) patch.taux_commission_pct = Math.min(100, Math.max(0, parseInt(body.taux_commission_pct) || 0));
      if (body.code != null && String(body.code).trim()) patch.code = String(body.code).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      let newPinPlain = null;
      if (body.pin != null && body.pin.trim()) {
        newPinPlain     = body.pin.trim();
        patch.pin       = hashPin(newPinPlain);
        patch.pin_hashed = true;
      }
      if (body.titulaire_compte != null) patch.titulaire_compte = body.titulaire_compte.trim() || null;
      if (body.iban != null)             patch.iban            = normalizeIban(body.iban);
      if (body.bic != null)              patch.bic             = normalizeBic(body.bic);
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Rien à modifier' });

      const { data: avantPart } = patch.code ? await supabase.from('partenaires').select('code').eq('id', id).maybeSingle() : { data: null };
      const ancienCode = avantPart && avantPart.code ? String(avantPart.code).toLowerCase() : '';
      const { error } = await supabase.from('partenaires').update(patch).eq('id', id);
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Ce code ou ce PIN est déjà utilisé par un autre partenaire, réessaie' });
        throw error;
      }
      // Le code a changé : le point de retrait relié suit (sinon il perdrait
      // son commerçant, sa commission et son code retour).
      if (ancienCode && ancienCode !== patch.code) {
        const PRet = require('./_lib/pointsRetrait');
        await PRet.chargerPoints(supabase, { force: true });
        for (const pt of PRet.POINTS_RETRAIT.filter((x) => x.partenaire_code && String(x.partenaire_code).toLowerCase() === ancienCode)) {
          const { data: l } = await supabase.from('points_retrait').select('data, actif').eq('id', pt.id).maybeSingle();
          await supabase.from('points_retrait').upsert({ id: pt.id, data: { ...((l && l.data) || {}), partenaire_code: patch.code }, actif: l ? l.actif : true, updated_at: new Date().toISOString() }, { onConflict: 'id' }).then(() => {}, () => {});
        }
        await PRet.chargerPoints(supabase, { force: true });
      }
      // Le code personnel a changé : renvoyer automatiquement le nouveau code
      // par email, comme à la création.
      if (newPinPlain) {
        const { data: fresh } = await supabase.from('partenaires').select('nom, email, code').eq('id', id).maybeSingle();
        if (fresh) await notifyPartenaireCredentials(supabase, { ...fresh, pin: newPinPlain });
      }
      // Fiche activée, ou téléphone / nom renseigné : parrainage à détecter.
      let parrainage = null;
      if (patch.actif === true || patch.telephone || patch.nom) {
        const { data: fiche } = await supabase.from('partenaires').select('id, nom, telephone, actif').eq('id', id).maybeSingle();
        if (fiche && fiche.actif !== false) parrainage = await detecterParrainage(supabase, fiche);
      }
      return res.status(200).json({ ok: true, parrainage });
    }

    if (action === 'delete') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const { data: owned } = await supabase.from('partenaires').select('id').eq('id', id).maybeSingle();
      if (!owned) return res.status(404).json({ error: 'Partenaire introuvable' });

      const { error } = await supabase.from('partenaires').delete().eq('id', id);
      if (error) {
        // Réservations ou virements liés : garder l'historique plutôt que de
        // le perdre silencieusement, comme pour un transporteur.
        if (error.code === '23503') {
          await supabase.from('partenaires').update({ actif: false }).eq('id', id);
          return res.status(200).json({ ok: true, deactivated: true, error: 'Ce partenaire a des réservations ou virements liés — il a été désactivé plutôt que supprimé, pour garder l\'historique.' });
        }
        throw error;
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    console.error('[Admin partenaires]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
