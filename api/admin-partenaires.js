const { getSupabase } = require('./_lib/supabase');
const { checkAdminToken } = require('./_lib/auth');
const { sendBrevoEmail } = require('./_lib/brevo');

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function partenaireLinkFor(code) { return `https://www.locair.fr/?p=${encodeURIComponent(code)}`; }

// Envoyée à la création ET à chaque changement de code personnel (admin ou
// "code oublié" côté partenaire) — évite à l'admin de devoir retransmettre le
// lien/code lui-même à chaque fois (jusqu'ici copié-collé à la main depuis la
// popup de l'admin). Ne fait jamais échouer l'appelant si l'envoi rate.
async function notifyPartenaireCredentials({ nom, email, code, pin }) {
  if (!email) return;
  await sendBrevoEmail({
    to:      email,
    subject: "Ton espace ambassadeur Loc'Air",
    html: `
      <p>Bonjour ${escHtml(nom)},</p>
      <p>Voici ton lien d'affiliation — mets-le sur ton site pour que tes clients réservent directement chez Loc'Air :</p>
      <p style="font-size:16px;font-weight:700"><a href="${partenaireLinkFor(code)}">${escHtml(partenaireLinkFor(code))}</a></p>
      <p>Ton code personnel pour suivre tes gains sur ton espace ambassadeur <a href="https://www.locair.fr/partenaire">locair.fr/partenaire</a> :</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px">${escHtml(pin)}</p>
      <p>Si tu n'es pas à l'origine de cette demande, contacte Aly immédiatement.</p>
    `,
  });
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
  if (!(await checkAdminToken(req, supabase))) return res.status(401).json({ error: 'Non autorisé' });

  const body   = req.body || {};
  const action = body.action || 'list';

  try {
    if (action === 'list') {
      const { data, error } = await supabase.from('partenaires').select('*').order('nom');
      if (error) throw error;
      return res.status(200).json({ partenaires: data || [] });
    }

    if (action === 'create') {
      const nom = (body.nom || '').trim();
      if (!nom) return res.status(400).json({ error: 'Nom requis' });
      const taux = Math.min(100, Math.max(0, parseInt(body.taux_commission_pct) || 10));
      const base = (body.code || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '') || slugifyNom(nom);
      const pinProvided = (body.pin || '').trim();

      for (let attempt = 0; attempt < 5; attempt++) {
        const code = attempt === 0 ? base : `${base}${Math.floor(10 + Math.random() * 90)}`;
        const pin  = pinProvided || String(Math.floor(100000 + Math.random() * 900000));
        const { data: created, error } = await supabase.from('partenaires').insert({
          nom,
          contact_nom:         (body.contact_nom || '').trim() || null,
          email:               (body.email || '').trim().toLowerCase() || null,
          telephone:           (body.telephone || '').trim() || null,
          code,
          pin,
          taux_commission_pct: taux,
          titulaire_compte:    (body.titulaire_compte || '').trim() || null,
          iban:                normalizeIban(body.iban),
          bic:                 normalizeBic(body.bic),
        }).select('id, code, pin').single();
        if (!error) {
          await notifyPartenaireCredentials({ nom, email: (body.email || '').trim().toLowerCase(), code: created.code, pin: created.pin });
          return res.status(200).json({ ok: true, code: created.code, pin: created.pin });
        }
        if (error.code !== '23505') throw error; // pas un conflit code/pin : autre erreur
        if (pinProvided && attempt > 0) return res.status(409).json({ error: 'Ce code personnel est déjà utilisé, réessaie' });
      }
      return res.status(500).json({ error: 'Impossible de générer un code unique, réessaie' });
    }

    if (action === 'update') {
      const id = parseInt(body.id);
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const patch = {};
      if (body.nom != null)         patch.nom         = body.nom.trim();
      if (body.contact_nom != null) patch.contact_nom = body.contact_nom.trim() || null;
      if (body.email != null)       patch.email       = body.email.trim().toLowerCase() || null;
      if (body.telephone != null)   patch.telephone   = body.telephone.trim() || null;
      if (body.actif != null)       patch.actif       = Boolean(body.actif);
      if (body.taux_commission_pct != null) patch.taux_commission_pct = Math.min(100, Math.max(0, parseInt(body.taux_commission_pct) || 0));
      if (body.code != null && body.code.trim()) patch.code = body.code.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      if (body.pin != null && body.pin.trim())   patch.pin  = body.pin.trim();
      if (body.titulaire_compte != null) patch.titulaire_compte = body.titulaire_compte.trim() || null;
      if (body.iban != null)             patch.iban            = normalizeIban(body.iban);
      if (body.bic != null)              patch.bic             = normalizeBic(body.bic);
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Rien à modifier' });

      const { error } = await supabase.from('partenaires').update(patch).eq('id', id);
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Ce code ou ce PIN est déjà utilisé par un autre partenaire, réessaie' });
        throw error;
      }
      // Le code personnel a changé (main ou fiche) : renvoyer automatiquement
      // le nouveau code par email, comme à la création.
      if (patch.pin) {
        const { data: fresh } = await supabase.from('partenaires').select('nom, email, code, pin').eq('id', id).maybeSingle();
        if (fresh) await notifyPartenaireCredentials(fresh);
      }
      return res.status(200).json({ ok: true });
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
