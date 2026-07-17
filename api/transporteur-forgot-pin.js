const { getSupabase }    = require('./_lib/supabase');
const { sendBrevoEmail } = require('./_lib/brevo');
const { tplNouveauCodeTransporteur } = require('./_lib/emailTemplates');
const { getSignature, signatureFooterHtml } = require('./_lib/emailEngine');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email = ((req.body || {}).email || '').trim().toLowerCase();
  // Toujours la même réponse, que l'email existe ou non — évite de révéler
  // quels emails sont enregistrés (énumération de comptes).
  const genericResponse = { ok: true, message: "Si ce compte existe, un email vient d'être envoyé." };
  if (!email) return res.status(200).json(genericResponse);

  try {
    const supabase = getSupabase();
    const { data: transp } = await supabase
      .from('transporteurs')
      .select('id, nom, email')
      .eq('actif', true)
      .eq('email', email)
      .maybeSingle();

    if (transp && transp.email) {
      // Un vrai reset : un nouveau code est généré et remplace l'ancien, qui
      // devient immédiatement invalide (y compris les sessions déjà ouvertes
      // avec l'ancien code — voir _lib/auth.js).
      let newPin = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = String(Math.floor(100000 + Math.random() * 900000));
        const { error } = await supabase.from('transporteurs').update({ pin: candidate }).eq('id', transp.id);
        if (!error) { newPin = candidate; break; }
        if (error.code !== '23505') throw error; // collision de code : réessayer
      }

      if (newPin) {
        // Même logique qu'un changement de code depuis l'admin : révoque tout
        // accès biométrique déjà enregistré (probable perte/vol de téléphone).
        await supabase.from('webauthn_credentials').delete().eq('transporteur_id', transp.id);
        const sig  = await getSignature(supabase);
        const html = tplNouveauCodeTransporteur({ nom: transp.nom, pin: newPin }) + signatureFooterHtml(sig);

        await sendBrevoEmail({ to: transp.email, subject: "🔐 Ton nouveau code Loc'Air", html, senderName: sig.nom_expediteur });
      }
    }

    return res.status(200).json(genericResponse);
  } catch (err) {
    console.error('[Transporteur forgot pin]', err.message);
    return res.status(200).json(genericResponse);
  }
};
