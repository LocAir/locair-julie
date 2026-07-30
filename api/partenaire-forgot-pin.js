const crypto             = require('crypto');
const { getSupabase }    = require('./_lib/supabase');
const { sendBrevoEmail } = require('./_lib/brevo');
const { tplNouveauCodeAmbassadeur } = require('./_lib/emailTemplates');
const { getSignature, withSignature } = require('./_lib/emailEngine');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');
const { hashPin } = require('./_lib/pinHash');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const rateKey = `forgot-partenaire:${getClientIp(req)}`;
  if (await isRateLimited(supabase, rateKey)) {
    return res.status(429).json({ ok: true, message: "Si ce compte existe, un email vient d'être envoyé." });
  }
  await recordFailedAttempt(supabase, rateKey).catch(() => {});

  const email = ((req.body || {}).email || '').trim().toLowerCase();
  // Toujours la même réponse, que l'email existe ou non — évite de révéler
  // quels emails sont enregistrés (énumération de comptes), même logique que
  // transporteur-forgot-pin.js.
  const genericResponse = { ok: true, message: "Si ce compte existe, un email vient d'être envoyé." };
  if (!email) return res.status(200).json(genericResponse);

  try {
    const { data: partenaire } = await supabase
      .from('partenaires')
      .select('id, nom, email, code')
      .eq('actif', true)
      .eq('email', email)
      .maybeSingle();

    if (partenaire && partenaire.email) {
      let newPin = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = String(crypto.randomInt(100000, 1000000));
        const hashed = hashPin(candidate);
        const { error } = await supabase.from('partenaires').update({ pin: hashed, pin_hashed: true }).eq('id', partenaire.id);
        if (!error) { newPin = candidate; break; }
        if (error.code !== '23505') throw error; // collision de code : réessayer
      }

      if (newPin) {
        const lien = `https://www.locair.fr/?p=${encodeURIComponent(partenaire.code)}`;
        const sig  = await getSignature(supabase);
        const html = withSignature(tplNouveauCodeAmbassadeur({ nom: partenaire.nom, lien, pin: newPin }), sig);

        const result = await sendBrevoEmail({ to: partenaire.email, subject: "🔐 Ton nouveau code ambassadeur Loc'Air", html, senderName: sig.nom_expediteur });
        // Jusqu'ici ni vérifié ni tracé nulle part (audit communications,
        // juillet 2026) — reservation_id:null, pas de réservation associée
        // à un compte ambassadeur.
        if (!result.ok) console.error('[Email code ambassadeur]', result.error);
        await supabase.from('email_log').insert({
          reservation_id: null, scenario: 'email_code_ambassadeur', canal: 'email',
          destinataire: partenaire.email, modele: 'email_code_ambassadeur',
          statut: result.ok ? 'envoye' : 'erreur',
          erreur: result.ok ? null : String(result.error || '').slice(0, 500),
          contenu: html,
        }).catch(() => {});
      }
    }

    return res.status(200).json(genericResponse);
  } catch (err) {
    console.error('[Partenaire forgot pin]', err.message);
    return res.status(200).json(genericResponse);
  }
};
