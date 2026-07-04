const { getSupabase }    = require('./_lib/supabase');
const { sendBrevoEmail } = require('./_lib/brevo');

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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
        await sendBrevoEmail({
          to:      transp.email,
          subject: 'Ton nouveau code Loc’Air',
          html: `
            <p>Bonjour ${escHtml(transp.nom)},</p>
            <p>Voici ton nouveau code personnel pour te connecter sur l'espace transporteur Loc'Air :</p>
            <p style="font-size:28px;font-weight:700;letter-spacing:4px">${escHtml(newPin)}</p>
            <p>Ton ancien code ne fonctionne plus. Si tu n'es pas à l'origine de cette demande, contacte Aly immédiatement.</p>
          `,
        });
      }
    }

    return res.status(200).json(genericResponse);
  } catch (err) {
    console.error('[Transporteur forgot pin]', err.message);
    return res.status(200).json(genericResponse);
  }
};
