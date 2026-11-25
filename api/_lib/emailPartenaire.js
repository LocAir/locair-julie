// Mise en page des e-mails aux commerçants (points de retrait), dans le
// style de la présentation commerçants (décidé le 25/11/2026) : bandeau bleu
// avec le logo et un gros titre blanc, surtitres en majuscules bleues,
// « 20 % » géant en vert, cartes blanches à bord fin, un seul bouton bleu.
// En tableaux et styles en ligne : lisible dans Gmail, Outlook et Apple Mail
// (DM Sans là où la police se charge, Arial ailleurs).

const C = {
  bleu: '#1A5EDB', bleuD: '#0D3FA0', bleuClair: '#E8F0FD', encre: '#0E1726', gris: '#4B5873',
  ligne: '#E3E9F4', papier: '#FBFCFE', brume: '#F2F6FD', vert: '#0F7A3D', vertClair: '#EAF6EF',
};
const F = "'DM Sans',Arial,Helvetica,sans-serif";
const REPLY = 'partenaires.locair@outlook.com';
const TEL = '06 63 79 87 56';

// Surtitre en majuscules (comme les « eyebrows » des diapos).
const surtitre = (t, couleur = C.bleu) =>
  `<p style="margin:0 0 10px;font-family:${F};font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${couleur}">${t}</p>`;

// Le « 20 % » géant en vert, avec sa légende.
const vingt = (legende = 'de chaque location.<br>Viré entre le 1er et le 5 du mois.') => `
  ${surtitre('Ce que vous gagnez')}
  <p style="margin:0;font-family:${F};font-size:76px;line-height:.95;font-weight:900;letter-spacing:-.05em;color:${C.vert}">20&nbsp;%</p>
  <p style="margin:10px 0 26px;font-family:${F};font-size:19px;line-height:1.3;font-weight:800;letter-spacing:-.01em;color:${C.encre}">${legende}</p>`;

// Une rangée de cartes (chiffre/mot fort + détail), comme « L'essentiel ».
function cartes(items) {
  const td = (it, i) => `<td width="${Math.floor(100 / items.length)}%" valign="top" style="padding:0 ${i < items.length - 1 ? 8 : 0}px 0 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;background:#FFFFFF;border:2px solid ${C.ligne};border-radius:18px"><tr><td class="crt" style="padding:16px 14px">
        <p class="crt-n" style="margin:0;white-space:nowrap;font-family:${F};font-size:24px;line-height:1.05;font-weight:900;letter-spacing:-.03em;color:${it.vert ? C.vert : C.bleu}">${it.n}</p>
        <p style="margin:6px 0 0;font-family:${F};font-size:13px;line-height:1.35;color:${C.gris}">${it.t}</p>
      </td></tr></table></td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>${items.map(td).join('')}</tr></table>`;
}

// Liste des pièces jointes, en cartes fines.
const pieces = (lignes) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">${lignes.map((l) =>
  `<tr><td style="padding:0 0 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;background:${C.brume};border-radius:14px"><tr>
    <td width="40" style="padding:12px 0 12px 14px;font-size:18px">📎</td>
    <td style="padding:12px 14px 12px 4px;font-family:${F};font-size:15px;color:${C.encre}"><b>${l[0]}</b>${l[1] ? `<span style="color:${C.gris}"> · ${l[1]}</span>` : ''}</td>
  </tr></table></td></tr>`).join('')}</table>`;

// Le seul bouton de l'e-mail.
const bouton = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0"><tr>
  <td style="border-radius:100px;background:${C.bleu}"><a href="${href}" style="display:inline-block;padding:17px 34px;font-family:${F};font-size:17px;font-weight:900;color:#FFFFFF;text-decoration:none;border-radius:100px">${label}</a></td>
</tr></table>`;

// Page complète : bandeau bleu (logo + surtitre + titre + intro), corps clair, pied.
function layoutPartenaire({ preheader = '', eyebrow = 'Point de retrait · Saison 2027', titre, intro = '', corps = '', cta, note = '' }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700;800;900&display=swap" rel="stylesheet">
<title>Loc’Air</title>
<style>@media (max-width:480px){.pad{padding-left:22px!important;padding-right:22px!important}.crt{padding:12px 10px!important}.crt-n{font-size:19px!important}.titre{font-size:29px!important}}</style></head>
<body style="margin:0;padding:0;background:${C.brume};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.brume}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;border-radius:24px;overflow:hidden;background:${C.papier}">
  <tr><td class="pad" style="background:${C.bleu};padding:30px 36px 34px">
    <p style="margin:0 0 30px;font-family:${F};font-size:24px;font-weight:900;letter-spacing:-.04em;color:#FFFFFF">Loc<em>’Air</em></p>
    ${surtitre(eyebrow, '#CFE0FF')}
    <h1 class="titre" style="margin:0;font-family:${F};font-size:34px;line-height:1.06;font-weight:900;letter-spacing:-.035em;color:#FFFFFF">${titre}</h1>
    ${intro ? `<p style="margin:14px 0 0;font-family:${F};font-size:16.5px;line-height:1.45;color:#DCE7FB">${intro}</p>` : ''}
  </td></tr>
  <tr><td class="pad" style="padding:30px 36px 32px">
    ${corps}
    ${cta ? bouton(cta.href, cta.label) : ''}
    ${note ? `<p style="margin:12px 0 0;font-family:${F};font-size:13.5px;line-height:1.45;color:${C.gris}">${note}</p>` : ''}
  </td></tr>
  <tr><td class="pad" style="padding:18px 36px 24px;border-top:2px solid ${C.ligne}">
    <p style="margin:0;font-family:${F};font-size:12.5px;line-height:1.6;color:${C.gris}"><b style="color:${C.encre}">Loc’Air · Point de retrait</b><br>${TEL} · <a href="mailto:${REPLY}" style="color:${C.bleu};text-decoration:none">${REPLY}</a></p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

module.exports = { layoutPartenaire, surtitre, vingt, cartes, pieces, bouton, COULEURS: C };
