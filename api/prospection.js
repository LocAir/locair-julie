// Prospection terrain des points de retrait (25/11/2026).
//
// Deux côtés, une seule fonction :
//  - le PROSPECTEUR (appli /prospection, connecté avec son code d'équipe) :
//    ouvrir une visite (QR code), suivre l'« OK » du commerçant, photo + GPS,
//    saisie rapide, envoi des documents, liste et tableau des zones ;
//  - le COMMERÇANT (page /partenaires?s=…, sans compte) : voir l'accord,
//    choisir 3, 4 ou 5 climatiseurs, « OK — j'accepte », signer du doigt,
//    télécharger sa convention.
// Table prospection_points (supabase/migration_2026-11-25_prospection.sql).
const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { checkProspecteur } = require('./_lib/auth');
const { roleHasAccess } = require('./_lib/permissions');
const { getClientIp, isRateLimited, recordFailedAttempt } = require('./_lib/ratelimit');
const { pushToAdmin } = require('./_lib/push');
const { sendBrevoEmail } = require('./_lib/brevo');
const { generateConventionPdf } = require('./_lib/conventionPdf');
const { envoyerDocuments, lienSigner, MODELE_AVANT_PASSAGE } = require('./_lib/prospection');

const ZONES = ['Nice', 'Antibes / Juan-les-Pins', 'Cannes'];
const OBJECTIF = { points_min: 8, points_max: 10, climatiseurs: 40 };
const STATUTS = ['session', 'a_repasser', 'en_attente_signature', 'signe', 'refuse'];
const BUCKET = 'missions';

const clip = (s, n) => (typeof s === 'string' || typeof s === 'number' ? String(s) : '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// Nombre de climatiseurs à la signature : souvent 3, 4 ou 5, mais libre
// (selon la place, d'un commun accord), et modifiable ensuite dans l'admin.
const capaciteOk = (n) => Number.isInteger(n) && n >= 1 && n <= 20;
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const pasDeTable = (e) => e && (e.code === '42P01' || /prospection_points/.test(e.message || '') && /does not exist|relation/.test(e.message || ''));
const MSG_TABLE = 'La table de prospection n’existe pas encore : collez le SQL du 25/11 dans Supabase (SQL Editor).';
const PUBLIC_COLS = 'id, session_token, statut, enseigne, gerant, email, tel, adresse, zone, capacite, accepte_at, signataire, signe_at';

async function ficheParToken(supabase, s) {
  const tok = clip(s, 80);
  if (!/^[a-f0-9]{32}$/.test(tok)) return { fiche: null };
  const { data, error } = await supabase.from('prospection_points').select('*').eq('session_token', tok).maybeSingle();
  return { fiche: data || null, error };
}

async function signaturePng(supabase, f) {
  if (!f.signature_path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).download(f.signature_path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

function publicFiche(f) {
  return { enseigne: f.enseigne || '', zone: f.zone || '', capacite: f.capacite || null, statut: f.statut, signe: f.statut === 'signe', signataire: f.signataire || '', email: f.email ? f.email.replace(/^(.).*(@.*)$/, '$1•••$2') : '' };
}

module.exports = async (req, res) => {
  const supabase = getSupabase();

  // ── Commerçant : télécharger sa convention (lien /api/prospection?s=…&pdf=1)
  if (req.method === 'GET') {
    const { fiche } = await ficheParToken(supabase, (req.query || {}).s);
    if (!fiche) return res.status(404).json({ error: 'Lien non valable.' });
    const sig = fiche.statut === 'signe' ? await signaturePng(supabase, fiche) : null;
    const pdf = await generateConventionPdf(fiche, sig);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="convention-locair${sig ? '-signee' : ''}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(pdf);
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const action = clip(b.action, 40);

  try {
    // ══ COMMERÇANT SANS VISITE (QR code de la fiche mémo, /partenaires) ═════
    // Demande très courte : boutique, nom, téléphone. Elle entre dans la même
    // liste que les visites, en « À repasser », et Loc'Air est prévenu.
    if (action === 'demande') {
      if (b.site_web) return res.json({ ok: true }); // piège anti-robots
      const ip = getClientIp(req);
      if (await isRateLimited(supabase, `prospection-demande:${ip}`, 5, 60).catch(() => false)) return res.status(429).json({ error: 'Trop d’envois. Appelez le 06 63 79 87 56.' });
      await recordFailedAttempt(supabase, `prospection-demande:${ip}`).catch(() => {});
      const enseigne = clip(b.enseigne, 120), gerant = clip(b.gerant, 120), tel = clip(b.tel, 30);
      const em = clip(b.email, 160).toLowerCase();
      if (!enseigne || !gerant || tel.replace(/\D/g, '').length < 9 || (em && !emailOk(em))) return res.status(400).json({ error: 'Il manque une information.' });
      const ligne = { session_token: crypto.randomBytes(16).toString('hex'), statut: 'a_repasser', enseigne, gerant, tel, email: em || null, zone: ZONES.includes(b.zone) ? b.zone : null, prospecteur: 'Demande en ligne', notes: clip(b.capacite ? `Place pour ${b.capacite} climatiseurs` : '', 60) || null };
      const { error } = await supabase.from('prospection_points').insert(ligne);
      if (error && !pasDeTable(error)) throw error;
      pushToAdmin(supabase, { title: `🏪 Demande point de retrait — ${enseigne}`, body: `${gerant} · ${tel}${ligne.zone ? ' · ' + ligne.zone : ''}`, tag: `prospection-demande-${Date.now()}` }).catch(() => {});
      await sendBrevoEmail({ to: process.env.CONTACT_EMAIL || 'contact@locair.fr', senderName: "Loc'Air Site", subject: `Demande point de retrait — ${enseigne}`, html: `<p><b>${enseigne.replace(/</g, '&lt;')}</b> veut devenir point de retrait.</p><p>${gerant.replace(/</g, '&lt;')} · ${tel.replace(/</g, '&lt;')}${em ? ' · ' + em.replace(/</g, '&lt;') : ''}${ligne.zone ? ' · ' + ligne.zone : ''}</p><p>À rappeler (Admin → Points de retrait → Prospection).</p>` }).catch(() => {});
      return res.json({ ok: true });
    }

    // ══ CÔTÉ COMMERÇANT (lien de session, sans compte) ══════════════════════
    if (['voir', 'accepter', 'signer'].includes(action)) {
      const ip = getClientIp(req);
      if (await isRateLimited(supabase, `prospection-pub:${ip}`, 30, 10).catch(() => false)) return res.status(429).json({ error: 'Trop d’essais. Réessayez dans quelques minutes.' });
      const { fiche: f, error } = await ficheParToken(supabase, b.s);
      if (pasDeTable(error)) return res.status(503).json({ error: 'Service bientôt disponible. Appelez le 06 63 79 87 56.' });
      if (!f || f.statut === 'refuse') {
        await recordFailedAttempt(supabase, `prospection-pub:${ip}`).catch(() => {});
        return res.status(404).json({ error: 'Ce lien n’est plus valable. Appelez le 06 63 79 87 56.' });
      }
      if (action === 'voir') return res.json({ ok: true, fiche: publicFiche(f) });

      if (action === 'accepter') {
        if (f.statut === 'signe') return res.json({ ok: true, fiche: publicFiche(f) });
        const capacite = Number(b.capacite);
        if (!capaciteOk(capacite)) return res.status(400).json({ error: 'Choisissez le nombre de climatiseurs (1 à 20).' });
        // Démarche progressive (décidé le 25/11/2026) : pas de signature sur
        // place. Le commerçant reçoit la présentation + la convention par
        // e-mail, l'étudie chez lui et signe depuis l'e-mail quand il veut.
        const email = clip(b.email, 160).toLowerCase() || String(f.email || '');
        if (!email || !emailOk(email)) return res.status(400).json({ error: 'Votre e-mail, pour recevoir la présentation et la convention.' });
        const patch = { capacite, statut: 'en_attente_signature', accepte_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        if (email) patch.email = email;
        const enseigne = clip(b.enseigne, 120); if (enseigne) patch.enseigne = enseigne;
        const gerant = clip(b.gerant, 120); if (gerant) patch.gerant = gerant;
        const { data, error: e2 } = await supabase.from('prospection_points').update(patch).eq('id', f.id).neq('statut', 'signe').select(PUBLIC_COLS).maybeSingle();
        if (e2) throw e2;
        pushToAdmin(supabase, { title: `✅ OK commerçant — ${patch.enseigne || f.enseigne || 'point ' + f.id}`, body: `${capacite} climatiseurs${email ? ' · ' + email : ''}`, tag: `prospection-ok-${f.id}` }).catch(() => {});
        // Envoi des documents tout de suite (une seule fois, même si le
        // commerçant retouche « OK »).
        let emailEnvoye = !!f.docs_envoyes_at;
        if (!emailEnvoye) {
          const { data: complete } = await supabase.from('prospection_points').select('*').eq('id', f.id).maybeSingle();
          const r = await envoyerDocuments(complete || { ...f, ...patch }).catch(() => ({ ok: false }));
          if (r && r.ok) { emailEnvoye = true; await supabase.from('prospection_points').update({ docs_envoyes_at: new Date().toISOString() }).eq('id', f.id).then(() => {}, () => {}); }
        }
        return res.json({ ok: true, fiche: publicFiche(data || { ...f, ...patch }), email_envoye: emailEnvoye });
      }

      // signer
      if (f.statut === 'signe') return res.json({ ok: true, fiche: publicFiche(f), pdf: `/api/prospection?s=${f.session_token}` });
      if (!f.capacite) return res.status(400).json({ error: 'Choisissez d’abord le nombre de climatiseurs.' });
      const signataire = clip(b.signataire, 120);
      if (signataire.length < 3) return res.status(400).json({ error: 'Écrivez votre nom et votre qualité (ex. Marie Dupont, gérante).' });
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(typeof b.signature === 'string' ? b.signature : '');
      const png = m ? Buffer.from(m[1], 'base64') : null;
      if (!png || png.length < 600 || png.length > 400000 || png.slice(1, 4).toString() !== 'PNG') return res.status(400).json({ error: 'Signez dans le cadre avec le doigt.' });
      const path = `prospection/signature-${f.id}-${crypto.randomBytes(6).toString('hex')}.png`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, png, { contentType: 'image/png', upsert: false });
      if (upErr) throw upErr;
      const email = clip(b.email, 160).toLowerCase();
      const patch = { statut: 'signe', signataire, signature_path: path, signe_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      if (email && emailOk(email)) patch.email = email;
      const { data: signee, error: e3 } = await supabase.from('prospection_points').update(patch).eq('id', f.id).neq('statut', 'signe').select('*').maybeSingle();
      if (e3) throw e3;
      const fs2 = signee || { ...f, ...patch };
      // Copie au commerçant (s'il a un e-mail) et à Loc'Air.
      let envoi = { ok: false };
      if (fs2.email) envoi = await envoyerDocuments(fs2, { signaturePng: png }).catch(() => ({ ok: false }));
      if (envoi.ok) await supabase.from('prospection_points').update({ docs_envoyes_at: new Date().toISOString() }).eq('id', f.id).then(() => {}, () => {});
      const pdf = await generateConventionPdf(fs2, png);
      sendBrevoEmail({
        to: process.env.CONTACT_EMAIL || 'contact@locair.fr', senderName: "Loc'Air Site",
        subject: `✍️ Convention signée — ${fs2.enseigne || 'point ' + f.id} (${fs2.capacite} clims)`,
        html: `<p><b>${(fs2.enseigne || '—').replace(/</g, '&lt;')}</b> a signé la convention (${fs2.capacite} climatiseurs) : ${String(signataire).replace(/</g, '&lt;')}.</p><p>Zone : ${(fs2.zone || '—').replace(/</g, '&lt;')} · Prospecteur : ${(fs2.prospecteur || '—').replace(/</g, '&lt;')}.</p><p>À faire : ajouter le point dans <code>api/_lib/pointsRetrait.js</code>, créer le commerçant (onglet Partenaires), imprimer l'affiche et le flyer.</p>`,
        attachments: [{ name: 'convention-signee.pdf', content: pdf }],
      }).catch(() => {});
      pushToAdmin(supabase, { title: `✍️ Signé — ${fs2.enseigne || 'point ' + f.id}`, body: `${fs2.capacite} climatiseurs · ${signataire}`, tag: `prospection-signe-${f.id}` }).catch(() => {});
      return res.json({ ok: true, fiche: publicFiche(fs2), pdf: `/api/prospection?s=${f.session_token}`, email_envoye: !!envoi.ok });
    }

    // ══ CÔTÉ PROSPECTEUR (compte d'équipe) ══════════════════════════════════
    const admin = await checkProspecteur(req, supabase);
    if (!admin.ok) return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });
    const qui = admin.nom || (admin.role === 'administrateur' ? 'Admin' : admin.role);
    const estGerant = roleHasAccess(admin.role, 'partenaires') || admin.role === 'administrateur';

    if (action === 'modeles') return res.json({ ok: true, avant_passage: MODELE_AVANT_PASSAGE, zones: ZONES, objectif: OBJECTIF });

    // Ouvrir une visite : une fiche + un QR code de session.
    if (action === 'ouvrir') {
      const zone = ZONES.includes(b.zone) ? b.zone : null;
      const ligne = { session_token: crypto.randomBytes(16).toString('hex'), statut: 'session', zone, prospecteur: qui, enseigne: clip(b.enseigne, 120) || null };
      const { data, error } = await supabase.from('prospection_points').insert(ligne).select('*').single();
      if (pasDeTable(error)) return res.status(503).json({ error: MSG_TABLE });
      if (error) throw error;
      return res.json({ ok: true, fiche: data, lien: `https://www.locair.fr/partenaires?s=${data.session_token}` }); // QR sur place : le choix, jamais la signature
    }

    const id = parseInt(b.id, 10);
    const lireFiche = async () => {
      if (!id) return null;
      const { data } = await supabase.from('prospection_points').select('*').eq('id', id).maybeSingle();
      return data;
    };

    if (action === 'etat') {
      const f = await lireFiche();
      if (!f) return res.status(404).json({ error: 'Fiche introuvable.' });
      return res.json({ ok: true, fiche: f });
    }

    // URL d'envoi de la photo (stockage privé).
    if (action === 'photo_url') {
      const f = await lireFiche();
      if (!f) return res.status(404).json({ error: 'Fiche introuvable.' });
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' }[b.format] || 'jpg';
      const path = `prospection/photo-${f.id}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
      if (error) throw error;
      return res.json({ ok: true, path: data.path || path, signedUrl: data.signedUrl });
    }

    // Enregistrer la fiche : photo + GPS (+ saisie rapide). Sans « OK » du
    // commerçant, la fiche passe en « À repasser », sans aucune saisie.
    if (action === 'enregistrer') {
      const f = await lireFiche();
      if (!f) return res.status(404).json({ error: 'Fiche introuvable.' });
      const patch = { updated_at: new Date().toISOString() };
      const p = clip(b.photo_path, 200);
      if (p) { if (!/^prospection\/photo-\d+-[a-f0-9]{12}\.(jpg|png|webp|heic)$/.test(p) || !p.includes(`photo-${f.id}-`)) return res.status(400).json({ error: 'Photo non valable.' }); patch.photo_path = p; }
      if (num(b.lat) != null && num(b.lng) != null && Math.abs(b.lat) <= 90 && Math.abs(b.lng) <= 180) { patch.lat = b.lat; patch.lng = b.lng; patch.gps_precision = num(b.precision); }
      for (const [k, n] of [['enseigne', 120], ['gerant', 120], ['tel', 30], ['adresse', 200], ['notes', 500]]) { const v = clip(b[k], n); if (v) patch[k] = v; }
      const em = clip(b.email, 160).toLowerCase(); if (em) { if (!emailOk(em)) return res.status(400).json({ error: 'E-mail incorrect.' }); patch.email = em; }
      if (ZONES.includes(b.zone)) patch.zone = b.zone;
      if (f.statut === 'session') patch.statut = f.capacite ? 'en_attente_signature' : 'a_repasser';
      const { data, error } = await supabase.from('prospection_points').update(patch).eq('id', f.id).select('*').single();
      if (error) throw error;
      return res.json({ ok: true, fiche: data });
    }

    // Saisie rapide terrain (gérant absent, sans QR) : une fiche « À repasser » d'un coup.
    if (action === 'saisie_rapide') {
      const enseigne = clip(b.enseigne, 120);
      if (!enseigne) return res.status(400).json({ error: 'Le nom de la boutique suffit, mais il le faut.' });
      const em = clip(b.email, 160).toLowerCase();
      if (em && !emailOk(em)) return res.status(400).json({ error: 'E-mail incorrect.' });
      const ligne = { session_token: crypto.randomBytes(16).toString('hex'), statut: 'a_repasser', enseigne, zone: ZONES.includes(b.zone) ? b.zone : null, tel: clip(b.tel, 30) || null, email: em || null, notes: clip(b.notes, 500) || null, prospecteur: qui };
      const { data, error } = await supabase.from('prospection_points').insert(ligne).select('*').single();
      if (pasDeTable(error)) return res.status(503).json({ error: MSG_TABLE });
      if (error) throw error;
      return res.json({ ok: true, fiche: data });
    }

    // Option B — envoyer la présentation + la convention pré-remplie (lien pour signer).
    if (action === 'envoyer') {
      const f = await lireFiche();
      if (!f) return res.status(404).json({ error: 'Fiche introuvable.' });
      const em = clip(b.email, 160).toLowerCase();
      if (em) { if (!emailOk(em)) return res.status(400).json({ error: 'E-mail incorrect.' }); f.email = em; await supabase.from('prospection_points').update({ email: em }).eq('id', f.id); }
      if (!f.email) return res.status(400).json({ error: 'Ajoutez l’e-mail du commerçant.' });
      const sig = f.statut === 'signe' ? await signaturePng(supabase, f) : null;
      const r = await envoyerDocuments(f, { signaturePng: sig });
      if (!r.ok) return res.status(502).json({ error: 'L’e-mail n’est pas parti. Réessayez.' });
      const { data } = await supabase.from('prospection_points').update({ docs_envoyes_at: new Date().toISOString(), statut: f.statut === 'session' ? 'en_attente_signature' : f.statut }).eq('id', f.id).select('*').single();
      return res.json({ ok: true, fiche: data || f });
    }

    if (action === 'liste') {
      const { data, error } = await supabase.from('prospection_points').select('*').neq('statut', 'session').order('updated_at', { ascending: false }).limit(300);
      if (pasDeTable(error)) return res.status(503).json({ error: MSG_TABLE });
      if (error) throw error;
      const lignes = data || [];
      const parZone = {};
      for (const z of [...ZONES, 'Sans zone']) parZone[z] = { signes: 0, climatiseurs: 0, en_attente: 0, a_repasser: 0 };
      for (const f of lignes) {
        const z = parZone[f.zone] ? f.zone : 'Sans zone';
        if (f.statut === 'signe') { parZone[z].signes++; parZone[z].climatiseurs += f.capacite || 0; }
        if (f.statut === 'en_attente_signature') parZone[z].en_attente++;
        if (f.statut === 'a_repasser') parZone[z].a_repasser++;
      }
      const signes = lignes.filter((f) => f.statut === 'signe');
      // Photos : liens temporaires (1 h) pour l'admin.
      const chemins = lignes.map((f) => f.photo_path).filter(Boolean);
      let urls = {};
      if (estGerant && chemins.length) {
        const { data: su } = await supabase.storage.from(BUCKET).createSignedUrls(chemins, 3600);
        for (const u of su || []) if (u && u.signedUrl) urls[u.path] = u.signedUrl;
      }
      return res.json({
        ok: true, zones: ZONES, objectif: OBJECTIF, par_zone: parZone,
        total: { signes: signes.length, climatiseurs: signes.reduce((s, f) => s + (f.capacite || 0), 0) },
        fiches: lignes.map((f) => ({ ...f, session_token: undefined, lien: lienSigner(f), photo_url: urls[f.photo_path] || null })),
      });
    }

    // Changer le statut à la main (signé sur papier, refusé, à repasser) — gérant seulement.
    if (action === 'statut') {
      if (!estGerant) return res.status(403).json({ error: 'Réservé au gérant.' });
      const statut = STATUTS.includes(b.statut) && b.statut !== 'session' ? b.statut : null;
      if (!statut) return res.status(400).json({ error: 'Statut inconnu.' });
      const patch = { statut, updated_at: new Date().toISOString() };
      if (statut === 'signe') {
        patch.signe_at = new Date().toISOString(); patch.signataire = clip(b.signataire, 120) || 'Signé sur papier';
        // Le nombre de climatiseurs compte dans l'objectif (40) : obligatoire si la fiche n'en a pas.
        const cap = Number(b.capacite);
        if (capaciteOk(cap)) patch.capacite = cap;
        else {
          const { data: cur } = await supabase.from('prospection_points').select('capacite').eq('id', id).maybeSingle();
          if (!cur || !cur.capacite) return res.status(400).json({ error: 'Indiquez le nombre de climatiseurs.' });
        }
      }
      const notes = clip(b.notes, 500); if (notes) patch.notes = notes;
      const { data, error } = await supabase.from('prospection_points').update(patch).eq('id', id).select('*').single();
      if (error) throw error;
      return res.json({ ok: true, fiche: data });
    }

    return res.status(400).json({ error: 'Action inconnue.' });
  } catch (e) {
    console.error('[prospection]', e.message);
    if (pasDeTable(e)) return res.status(503).json({ error: MSG_TABLE });
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};
