// Confirmation Click & Collect à télécharger (PDF), depuis l'écran « C'est
// réservé ». Contient tout ce qu'il faut au comptoir : le numéro de
// commande (le seul numéro du séjour), le QR code de retrait, la boutique
// (adresse, horaires), les dates, le prix payé et les consignes.
// GET /api/cc-confirmation?t=<id>.<code> — même code que le QR code de
// retrait (clickCollect.codeRemise), donc seul le client qui a payé l'a.
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { safeEqual } = require('./_lib/auth');
const { codeRemise, lienRemise } = require('./_lib/clickCollect');
const { getPointRetrait } = require('./_lib/pointsRetrait');

const BLEU = '#1A5EDB', ENCRE = '#0E1726', GRIS = '#4B5873', BRUME = '#F2F6FD';

function eur(cents, l) {
  const v = (Number(cents) || 0) / 100;
  return l === 'en' ? '€' + v.toFixed(2) : v.toFixed(2).replace('.', ',') + ' €';
}
function dateLongue(iso, l) {
  if (!iso) return '—';
  return new Date(iso + 'T12:00:00Z').toLocaleDateString(l === 'en' ? 'en-GB' : l === 'es' ? 'es-ES' : 'fr-FR',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
}

// QR code en image (même service que l'email). En cas d'échec : pas de QR,
// le numéro de commande suffit au comptoir.
async function imageQr(lien) {
  try {
    const r = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=0&format=png&data=${encodeURIComponent(lien)}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch (e) { return null; }
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const [idTxt, code] = String((req.query || {}).t || '').split('.');
  const id = parseInt(idTxt, 10);
  if (!id || !code || !process.env.TRANSPORTEUR_SECRET) return res.status(400).json({ error: 'Lien invalide.' });
  try {
    const { data: r } = await getSupabase().from('reservations').select('*').eq('id', id).maybeSingle();
    if (!r || r.source_channel !== 'click_collect' || !safeEqual(code, codeRemise(r.id, r.ref))) return res.status(404).json({ error: 'Réservation introuvable.' });
    if (!['confirmee', 'terminee', 'en_attente'].includes(r.statut)) return res.status(409).json({ error: 'Cette réservation n’est plus active.' });

    const l = r.lang === 'en' || r.lang === 'es' ? r.lang : 'fr';
    const T = (fr, en, es) => (l === 'en' ? en : l === 'es' ? es : fr);
    const pt = getPointRetrait(r.point_retrait_id || '');
    const lieu = pt ? pt.nom : String(r.adresse || '').replace(/^CLICK & COLLECT — /, '').split(' — ')[0];
    const adresse = pt ? pt.adresse : String(r.adresse || '').replace(/^CLICK & COLLECT — /, '');
    const o = (pt && pt.ouverture) || [9, 19];
    const horaires = pt && pt.horaires ? pt.horaires : T(`${o[0]} h – ${o[1]} h`, `${o[0]}:00–${o[1]}:00`, `${o[0]}:00–${o[1]}:00`);
    const qr = await imageQr(lienRemise(r.id, r.ref));

    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Loc'Air — ${r.ref}` } });
    const morceaux = [];
    doc.on('data', (c) => morceaux.push(c));
    const fini = new Promise((ok) => doc.on('end', ok));
    const W = 595.28, M = 48;

    // bandeau
    doc.rect(0, 0, W, 92).fill(BLEU);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(26).text("Loc'Air", M, 30);
    doc.font('Helvetica').fontSize(12).text(T('Confirmation de réservation · Click & Collect', 'Booking confirmation · Click & Collect', 'Confirmación de reserva · Click & Collect'), M, 62);

    // numéro de commande
    let y = 122;
    doc.fillColor(GRIS).font('Helvetica').fontSize(11).text(T('VOTRE NUMÉRO DE COMMANDE', 'YOUR ORDER NUMBER', 'TU NÚMERO DE PEDIDO'), M, y, { characterSpacing: 1 });
    doc.fillColor(ENCRE).font('Helvetica-Bold').fontSize(34).text(r.ref || '', M, y + 18);
    doc.fillColor(GRIS).font('Helvetica').fontSize(11).text(T('Gardez-le jusqu’au retour de l’appareil, même si vous prolongez.', 'Keep it until you return the unit, even if you extend.', 'Guárdalo hasta devolver el aparato, aunque amplíes.'), M, y + 60, { width: 300 });

    // QR code
    if (qr) {
      doc.roundedRect(W - M - 150, 112, 150, 150, 10).lineWidth(3).stroke(BLEU);
      doc.image(qr, W - M - 138, 124, { width: 126, height: 126 });
      doc.fillColor(GRIS).fontSize(9).text(T('À montrer au comptoir', 'Show at the counter', 'Enséñalo en el mostrador'), W - M - 150, 268, { width: 150, align: 'center' });
    }

    // détails
    y = 300;
    const ligne = (titre, valeur) => {
      doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.6).stroke('#E3E9F4');
      doc.fillColor(GRIS).font('Helvetica').fontSize(11).text(titre, M, y + 12, { width: 150 });
      const h = doc.fillColor(ENCRE).font('Helvetica-Bold').fontSize(12).heightOfString(valeur, { width: W - 2 * M - 160 });
      doc.text(valeur, M + 160, y + 11, { width: W - 2 * M - 160 });
      y += Math.max(36, h + 22);
    };
    ligne(T('Point de retrait', 'Pick-up point', 'Punto de recogida'), `${lieu}\n${adresse}`);
    ligne(T('Horaires', 'Opening hours', 'Horario'), horaires);
    ligne(T('Retrait', 'Pick-up', 'Recogida'), dateLongue(r.date_debut, l));
    ligne(T('Retour (même point)', 'Return (same point)', 'Devolución (mismo punto)'), dateLongue(r.date_fin, l));
    ligne(T('Payé', 'Paid', 'Pagado'), eur(r.prix_total_cents, l) + T(' · sans caution', ' · no deposit', ' · sin fianza'));
    ligne(T('Au nom de', 'Name', 'A nombre de'), `${r.prenom || ''} ${r.nom || ''}`.trim());
    doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.6).stroke('#E3E9F4');

    // consignes
    y += 22;
    const boxY = y;
    const points = [
      T('Montrez ce QR code, ou scannez celui du commerçant et tapez votre numéro de commande.', 'Show this QR code, or scan the shop’s QR code and enter your order number.', 'Enseña este código QR, o escanea el del comercio y escribe tu número de pedido.'),
      T('Apportez votre pièce d’identité originale (carte d’identité ou passeport).', 'Bring your original ID (ID card or passport).', 'Trae tu documento de identidad original (DNI o pasaporte).'),
      T('Le kit fenêtre n’est pas fourni : la gaine passe par une fenêtre entrouverte.', 'The window kit isn’t included: the hose goes through a half-open window.', 'El kit de ventana no está incluido: el tubo sale por una ventana entreabierta.'),
      T('Venez en voiture pour repartir avec l’appareil. Il vous est remis dans sa housse : gardez-la.', 'Come by car to take the unit home. It comes in its cover: keep it.', 'Ven en coche para llevarte el aparato. Se entrega en su funda: guárdala.'),
      T('Une fois par semaine, rincez le filtre (2 min). Au retour : appareil dans sa housse, filtre propre.', 'Once a week, rinse the filter (2 min). On return: unit in its cover, clean filter.', 'Una vez por semana, enjuaga el filtro (2 min). Al devolverlo: aparato en su funda, filtro limpio.'),
    ];
    // hauteur du cadre calculée d'après le texte (il ne déborde jamais)
    doc.font('Helvetica').fontSize(11);
    const hTexte = points.reduce((h, p) => h + doc.heightOfString('•  ' + p, { width: W - 2 * M - 36 }) + 6, 0);
    doc.roundedRect(M, boxY, W - 2 * M, 40 + hTexte + 14, 12).fill(BRUME);
    doc.fillColor(ENCRE).font('Helvetica-Bold').fontSize(13).text(T('Au comptoir', 'At the counter', 'En el mostrador'), M + 18, boxY + 16);
    doc.font('Helvetica').fontSize(11).fillColor(ENCRE);
    let yy = boxY + 40;
    for (const p of points) { doc.text('•  ' + p, M + 18, yy, { width: W - 2 * M - 36 }); yy += doc.heightOfString('•  ' + p, { width: W - 2 * M - 36 }) + 6; }

    // pied
    doc.fillColor(GRIS).fontSize(10).text(T('Une question ? Écrivez à Julie, notre assistante, sur locair.fr/click-and-collect. Pour prolonger : locair.fr/client.',
      'Any question? Chat with Julie, our assistant, on locair.fr/click-and-collect. To extend: locair.fr/client.',
      '¿Alguna pregunta? Escribe a Julie, nuestra asistente, en locair.fr/click-and-collect. Para ampliar: locair.fr/client.'), M, 780, { width: W - 2 * M, align: 'center' });
    doc.end();
    await fini;
    const pdf = Buffer.concat(morceaux);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="LocAir-${String(r.ref || 'confirmation').replace(/[^A-Z0-9-]/gi, '')}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(pdf);
  } catch (e) {
    console.error('[cc-confirmation]', e.message);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};
