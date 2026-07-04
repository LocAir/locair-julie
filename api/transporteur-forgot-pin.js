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
      .select('nom, pin, email')
      .eq('actif', true)
      .ilike('email', email)
      .maybeSingle();

    if (transp && transp.email) {
      await sendBrevoEmail({
        to:      transp.email,
        subject: "Ton code d'accès Loc'Air",
        html: `
          <p>Bonjour ${escHtml(transp.nom)},</p>
          <p>Voici ton code personnel pour te connecter sur l'espace transporteur Loc'Air :</p>
          <p style="font-size:28px;font-weight:700;letter-spacing:4px">${escHtml(transp.pin)}</p>
          <p>Si tu n'es pas à l'origine de cette demande, contacte Aly.</p>
        `,
      });
    }

    return res.status(200).json(genericResponse);
  } catch (err) {
    console.error('[Transporteur forgot pin]', err.message);
    return res.status(200).json(genericResponse);
  }
};
