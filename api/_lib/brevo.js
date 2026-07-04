async function sendBrevoEmail({ to, subject, html }) {
  if (!process.env.BREVO_API_KEY || !to) return;
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
      body:    JSON.stringify({
        sender:      { name: "Loc'Air", email: 'contact@locair.fr' },
        to:          [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    if (!r.ok) console.error('[Brevo]', r.status, await r.text());
  } catch (e) {
    console.error('[Brevo]', e.message);
  }
}

module.exports = { sendBrevoEmail };
