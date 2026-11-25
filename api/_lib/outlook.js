// Envoi des e-mails « partenaires » depuis la boîte Outlook de Loc'Air
// (partenaires.locair@outlook.com), décidé par le propriétaire le 25/11/2026 :
// tout ce qui concerne les points de retrait et les commerçants part de
// cette adresse, et apparaît dans ses « Éléments envoyés ».
//
// Comment ça marche :
// - une « appli » Microsoft (variables Vercel MS_CLIENT_ID, MS_CLIENT_SECRET) ;
// - le propriétaire se connecte une fois depuis l'admin (api/outlook.js) :
//   Microsoft donne un jeton longue durée (refresh token), gardé dans la
//   table `outlook_connexion` (une seule ligne, id = 1) ;
// - à chaque envoi : jeton court (1 h) → Microsoft Graph /me/sendMail.
// Si Outlook n'est pas relié ou refuse, l'appelant (sendBrevoEmail) repasse
// par Brevo : un e-mail à un commerçant ne se perd jamais.

const { getSupabase } = require('./supabase');

const BOITE = 'partenaires.locair@outlook.com';
const TENANT = process.env.MS_TENANT || 'consumers'; // compte outlook.com = compte personnel
const SCOPES = 'offline_access User.Read Mail.Send';
const TIMEOUT_MS = 10000;
// Après un échec, on laisse Outlook de côté 10 minutes : les envois
// suivants partent directement par Brevo. Sans ça, une boîte Outlook lente
// ferait attendre chaque e-mail du cron quotidien (relevés, relances)
// jusqu'à dépasser la limite de 60 s de Vercel.
const PAUSE_APRES_ECHEC_MS = 10 * 60 * 1000;
let _pauseJusqua = 0;

function configure() {
  return Boolean(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

function redirectUri() {
  return process.env.MS_REDIRECT_URI || 'https://locair.fr/api/outlook';
}

function lienConnexion(state) {
  const p = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID || '',
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: SCOPES,
    state,
    prompt: 'select_account',
    login_hint: BOITE,
  });
  return `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?${p}`;
}

async function appelJeton(params) {
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID || '',
      client_secret: process.env.MS_CLIENT_SECRET || '',
      redirect_uri: redirectUri(),
      scope: SCOPES,
      ...params,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Microsoft ${r.status} : ${j.error_description || j.error || 'jeton refusé'}`.slice(0, 300));
  return j;
}

// Jeton court gardé en mémoire tant que la fonction Vercel reste chaude.
let _cache = null; // { token, exp }

async function lireLigne(supabase) {
  const { data, error } = await supabase.from('outlook_connexion').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function noter(supabase, patch) {
  try { await supabase.from('outlook_connexion').update(patch).eq('id', 1); } catch (_) { /* jamais bloquant */ }
}

async function jetonAcces(supabase) {
  if (_cache && _cache.exp > Date.now() + 60000) return _cache.token;
  const ligne = await lireLigne(supabase);
  if (!ligne || !ligne.refresh_token) throw new Error('Outlook pas relié');
  const j = await appelJeton({ grant_type: 'refresh_token', refresh_token: ligne.refresh_token });
  _cache = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  // Microsoft donne souvent un nouveau refresh token : on garde toujours le dernier.
  if (j.refresh_token && j.refresh_token !== ligne.refresh_token) await noter(supabase, { refresh_token: j.refresh_token });
  return j.access_token;
}

// Premier branchement (retour de la page Microsoft) : échange le code,
// vérifie que c'est bien la boîte partenaires, et garde le jeton.
async function relier(code, supabase) {
  const j = await appelJeton({ grant_type: 'authorization_code', code });
  if (!j.refresh_token) throw new Error('Microsoft n’a pas donné de jeton longue durée (offline_access manquant)');
  const me = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${j.access_token}` }, signal: AbortSignal.timeout(TIMEOUT_MS),
  }).then(r => r.json()).catch(() => ({}));
  const compte = String(me.mail || me.userPrincipalName || '').toLowerCase();
  if (compte !== BOITE) throw new Error(`Mauvais compte : ${compte || 'inconnu'}. Connectez-vous avec ${BOITE}.`);
  const { error } = await supabase.from('outlook_connexion').upsert({
    id: 1, compte, refresh_token: j.refresh_token, connecte_at: new Date().toISOString(), derniere_erreur: null,
  });
  if (error) throw new Error(error.message);
  _cache = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  _pauseJusqua = 0;
  return compte;
}

async function etat(supabase) {
  if (!configure()) return { configure: false, relie: false };
  try {
    const l = await lireLigne(supabase);
    return {
      configure: true,
      relie: Boolean(l && l.refresh_token),
      compte: l ? l.compte : null,
      connecte_at: l ? l.connecte_at : null,
      dernier_envoi_at: l ? l.dernier_envoi_at : null,
      derniere_erreur: l ? l.derniere_erreur : null,
    };
  } catch (e) {
    return { configure: true, relie: false, table_manquante: /outlook_connexion/.test(e.message), erreur: e.message };
  }
}

async function enBase64(a) {
  if (a.content) return Buffer.isBuffer(a.content) ? a.content.toString('base64') : String(a.content);
  if (a.url) {
    const r = await fetch(a.url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) throw new Error(`pièce jointe introuvable (${r.status})`);
    return Buffer.from(await r.arrayBuffer()).toString('base64');
  }
  return '';
}

// Renvoie { ok: true } ou { ok: false, error } — ne jette jamais.
async function sendOutlookEmail({ to, subject, html, attachments, forcer = false }) {
  if (!configure() || !to) return { ok: false, error: 'Outlook pas configuré' };
  // « Essai » (forcer) tente toujours : la pause ne sert qu'aux envois automatiques.
  if (!forcer && Date.now() < _pauseJusqua) return { ok: false, error: 'Outlook en pause après un échec récent' };
  let supabase;
  try { supabase = getSupabase(); } catch (e) { return { ok: false, error: e.message }; }
  try {
    const token = await jetonAcces(supabase);
    const message = {
      subject: subject || '',
      body: { contentType: 'HTML', content: html || '' },
      toRecipients: [{ emailAddress: { address: to } }],
    };
    if (attachments && attachments.length) {
      message.attachments = [];
      for (const a of attachments) {
        message.attachments.push({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: a.name || 'piece-jointe.pdf',
          contentType: /\.pdf$/i.test(a.name || '') ? 'application/pdf' : 'application/octet-stream',
          contentBytes: await enBase64(a),
        });
      }
    }
    const r = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, saveToSentItems: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (r.status !== 202 && !r.ok) {
      const detail = (await r.text()).slice(0, 300);
      if (r.status === 401) _cache = null;
      throw new Error(`Outlook ${r.status} : ${detail}`);
    }
    await noter(supabase, { dernier_envoi_at: new Date().toISOString(), derniere_erreur: null });
    return { ok: true, via: 'outlook' };
  } catch (e) {
    console.error('[Outlook]', e.message);
    if (e.message !== 'Outlook pas relié') _pauseJusqua = Date.now() + PAUSE_APRES_ECHEC_MS;
    await noter(supabase, { derniere_erreur: `${new Date().toISOString().slice(0, 16)} · ${e.message}`.slice(0, 400) });
    return { ok: false, error: e.message };
  }
}

function estAdressePartenaires(adr) {
  return String(adr || '').trim().toLowerCase() === BOITE;
}

module.exports = { BOITE, configure, lienConnexion, relier, etat, sendOutlookEmail, estAdressePartenaires };
