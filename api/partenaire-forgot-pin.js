const { getSupabase }    = require('./_lib/supabase');
const { sendBrevoEmail } = require('./_lib/brevo');

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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
        await sendBrevoEmail({
          to:      partenaire.email,
          subject: 'Ton nouveau code Loc’Air',
          html: `
            <p>Bonjour ${escHtml(partenaire.nom)},</p>
            <p>Voici ton nouveau code personnel pour te connecter sur l'espace ambassadeur Loc'Air :</p>
            <p style="font-size:28px;font-weight:700;letter-spacing:4px">${escHtml(newPin)}</p>
            <p>Ton lien d'affiliation ne change pas :</p>
            <p><a href="https://www.locair.fr/?p=${encodeURIComponent(partenaire.code)}">https://www.locair.fr/?p=${escHtml(partenaire.code)}</a></p>
            <p>Ton ancien code ne fonctionne plus. Si tu n'es pas à l'origine de cette demande, contacte Aly immédiatement.</p>
          `,
        });
      }
    }

    return res.status(200).json(genericResponse);
  } catch (err) {
    console.error('[Partenaire forgot pin]', err.message);
    return res.status(200).json(genericResponse);
  }
};
