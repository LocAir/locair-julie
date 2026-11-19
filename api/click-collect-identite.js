// Pièce d'identité ajoutée APRÈS le paiement Click & Collect (écran
// « C'est réservé »). Le client paie d'abord (moins d'abandons), puis
// envoie sa carte d'identité (recto + verso) ou son passeport.
//
// Les fichiers sont déjà dans le bucket privé « missions » (envoyés avec les
// URL signées de /api/upload-identite) ; ici on les rattache à la
// réservation. Sécurité : le code (HMAC de l'id + ref, voir
// _lib/clickCollect.js → codeIdentite) n'est donné qu'au navigateur qui a
// payé ; une pièce déjà enregistrée n'est jamais remplacée.
const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');
const { codeIdentite } = require('./_lib/clickCollect');

const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
const CHEMIN = /^identites\/\d+-[a-f0-9]{18}\/(recto|verso|passeport)\.(jpg|png|webp|heic|heif|pdf)$/;

function egal(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.TRANSPORTEUR_SECRET) return res.status(500).json({ error: 'Configuration serveur manquante.' });
  const supabase = getSupabase();
  const ip = getClientIp(req);
  try {
    if (await isRateLimited(supabase, `identite-resa:${ip}`, 10, 10)) return res.status(429).json({ error: 'Trop d’essais, réessayez dans quelques minutes.' });
  } catch (_e) { /* non bloquant */ }

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const id = Number(b.id);
  const type = b.type === 'cni' || b.type === 'passeport' ? b.type : '';
  const chemins = Array.isArray(b.paths) ? b.paths.map((x) => clip(x, 200)) : [];
  const attendu = type === 'cni' ? 2 : type === 'passeport' ? 1 : 0;
  if (!Number.isInteger(id) || id <= 0 || !attendu || chemins.length !== attendu || !chemins.every((x) => CHEMIN.test(x))) {
    return res.status(400).json({ error: 'Pièce d’identité incomplète (carte recto et verso, ou passeport).' });
  }

  const { data: resa, error } = await supabase.from('reservations').select('*').eq('id', id).maybeSingle();
  if (error || !resa || resa.source_channel !== 'click_collect' || !egal(clip(b.code, 40), codeIdentite(resa.id, resa.ref))) {
    await recordFailedAttempt(supabase, `identite-resa:${ip}`).catch(() => {});
    return res.status(403).json({ error: 'Lien non valable. Apportez votre pièce d’identité au retrait.' });
  }

  // Colonne présente (migration 2026-11-18 appliquée) : on remplit, sans
  // jamais écraser une pièce déjà reçue.
  if ('piece_identite_paths' in resa) {
    if (Array.isArray(resa.piece_identite_paths) && resa.piece_identite_paths.length) {
      return res.status(409).json({ error: 'Votre pièce d’identité est déjà enregistrée.' });
    }
    const { error: e2 } = await supabase.from('reservations').update({ piece_identite_paths: chemins }).eq('id', id);
    if (e2) { console.error('[CC identite]', e2.message); return res.status(500).json({ error: 'Enregistrement impossible. Apportez votre pièce au retrait.' }); }
  } else {
    const note = `${resa.instructions_acces || ''} | PIÈCE D'IDENTITÉ (${type}) : ${chemins.join(' ; ')}`.slice(0, 1000);
    const { error: e3 } = await supabase.from('reservations').update({ instructions_acces: note }).eq('id', id);
    if (e3) { console.error('[CC identite note]', e3.message); return res.status(500).json({ error: 'Enregistrement impossible. Apportez votre pièce au retrait.' }); }
  }
  return res.status(200).json({ ok: true });
};
