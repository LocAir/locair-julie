const { getSupabase }    = require('./_lib/supabase');
const { sendBrevoEmail } = require('./_lib/brevo');
const { tplNouveauCodeAmbassadeur } = require('./_lib/emailTemplates');
const { getSignature, withSignature } = require('./_lib/emailEngine');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email = ((req.body || {}).email || '').trim().toLowerCase();
  // Toujours la même réponse, que l'email existe ou non — évite de révéler
  // quels emails sont enregistrés (énumération de comptes), même logique que
  // transporteur-forgot-pin.js.
  const genericResponse = { ok: true, message: "Si ce compte existe, un email vient d'être envoyé." };
  if (!email) return res.status(200).json(genericResponse);

  try {
    const supabase = getSupabase();
    const { data: partenaire } = await supabase
      .from('partenaires')
      .select('id, nom, email, code')
      .eq('actif', true)
      .eq('email', email)
      .maybeSingle();

    if (partenaire && partenaire.email) {
      let newPin = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = String(Math.floor(100000 + Math.random() * 900000));
        const { error } = await supabase.from('partenaires').update({ pin: candidate }).eq('id', partenaire.id);
        if (!error) { newPin = candidate; break; }
        if (error.code !== '23505') throw error; // collision de code : réessayer
      }

      if (newPin) {
        const lien = `https://www.locair.fr/?p=${encodeURIComponent(partenaire.code)}`;
        const sig  = await getSignature(supabase);
        const html = withSignature(tplNouveauCodeAmbassadeur({ nom: partenaire.nom, lien, pin: newPin }), sig);

        await sendBrevoEmail({ to: partenaire.email, subject: "🔐 Ton nouveau code ambassadeur Loc'Air", html, senderName: sig.nom_expediteur });
      }
    }

    return res.status(200).json(genericResponse);
  } catch (err) {
    console.error('[Partenaire forgot pin]', err.message);
    return res.status(200).json(genericResponse);
  }
};
