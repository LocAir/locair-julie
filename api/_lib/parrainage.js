// Parrainage entre commerçants (voir CLAUDE.md) : détection automatique.
//
// 1. Quand l'admin crée (ou réactive) la fiche d'un commerçant, on cherche
//    une demande de parrainage « en attente » qui lui correspond (même
//    téléphone, ou même nom de commerce). Trouvée : elle passe à « signé »,
//    reliée à la fiche (filleul_id) ; notification admin + email au parrain.
//    L'admin voit une fenêtre « Parrainage détecté ».
// 2. À la 1re location payée de ce nouveau commerçant (webhook Stripe) :
//    notification + email « à verser » (50 € au parrain ET 50 € au nouveau
//    commerçant, versés à la main avec le 1er virement).
// Table absente (migration pas passée) : tout est ignoré sans erreur.
const { pushToAdmin } = require('./push');
const { sendBrevoEmail } = require('./brevo');

// Parrainage : 50 € au parrain et 50 € au nouveau commerçant (décidé le 22/11/2026).
const PRIME_CENTS = 5000;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const chiffres = (t) => String(t || '').replace(/\D/g, '').slice(-9);
const nomSimple = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const euros = (c) => (Math.round(c) / 100).toFixed(2).replace('.', ',') + ' €';

async function detecterParrainage(supabase, partenaire) {
  try {
    if (!partenaire || !partenaire.id) return null;
    const { data: liste, error } = await supabase.from('parrainages')
      .select('id, parrain_id, parrain_nom, commerce, contact_nom, tel')
      .eq('statut', 'en_attente').order('created_at', { ascending: true }).limit(500); // le 1er parrain gagne
    if (error || !liste || !liste.length) return null;
    const tel = chiffres(partenaire.telephone);
    const nom = nomSimple(partenaire.nom);
    const correspond = (x) => (tel.length === 9 && chiffres(x.tel) === tel) || (nom.length >= 4 && nomSimple(x.commerce) === nom);
    const p = liste.find((x) => x.parrain_id !== partenaire.id && correspond(x));
    if (!p) return null;

    const { data: maj } = await supabase.from('parrainages')
      .update({ statut: 'signe', signe_at: new Date().toISOString(), filleul_id: partenaire.id })
      .eq('id', p.id).eq('statut', 'en_attente').select('id');
    if (!maj || !maj.length) return null;
    // Les autres demandes pour ce même commerce (autre parrain, plus tard) :
    // « Pas cette fois » dans leur espace, au lieu de rester en attente.
    const autres = liste.filter((x) => x.id !== p.id && correspond(x)).map((x) => x.id);
    if (autres.length) await supabase.from('parrainages').update({ statut: 'refuse' }).in('id', autres).eq('statut', 'en_attente').then(() => {}, () => {});

    pushToAdmin(supabase, {
      title: `🎁 Parrainage détecté — ${partenaire.nom}`,
      body: `Parrainé par ${p.parrain_nom || '—'}. À sa 1re location : 50 € au parrain et 50 € à ${partenaire.nom}.`,
      tag: `parrainage-signe-${p.id}`,
    }).catch(() => {});

    if (p.parrain_id) {
      const { data: parrain } = await supabase.from('partenaires').select('nom, email').eq('id', p.parrain_id).maybeSingle();
      if (parrain && parrain.email) {
        await sendBrevoEmail({
          to: parrain.email,
          subject: `${partenaire.nom} a signé grâce à vous`,
          html: `<div style="font-family:Arial,sans-serif;color:#0E1726;max-width:560px">
<h2 style="color:#1A5EDB;margin:0 0 12px">Bonne nouvelle !</h2>
<p><b>${esc(partenaire.nom)}</b> devient point de retrait Loc’Air grâce à vous.</p>
<p>Votre bonus : <b>50 €</b>, versé avec votre virement dès sa 1re location.</p>
<p><a href="https://www.locair.fr/partenaire" style="color:#1A5EDB;font-weight:bold">Voir mon espace</a></p>
<p style="color:#4B5873;font-size:13px">Loc’Air · 06 63 79 87 56 · partenaires.locair@outlook.com</p></div>`,
          senderName: "Loc'Air", replyTo: 'partenaires.locair@outlook.com',
        }).catch(() => {});
      }
    }
    return { id: p.id, commerce: p.commerce, parrain_nom: p.parrain_nom || '' };
  } catch (e) {
    console.error('[parrainage détection]', e.message);
    return null;
  }
}

// À appeler quand une réservation est payée et confirmée.
async function premiereLocationParrainee(supabase, resa) {
  try {
    if (!resa || !resa.partenaire_id || resa.reservation_origine_id) return;
    const { data: maj, error } = await supabase.from('parrainages')
      .update({ premiere_resa_id: resa.id })
      .eq('filleul_id', resa.partenaire_id).eq('statut', 'signe').is('premiere_resa_id', null)
      .select('id, parrain_nom');
    if (error || !maj || !maj.length) return;
    const { data: filleul } = await supabase.from('partenaires').select('nom').eq('id', resa.partenaire_id).maybeSingle();
    const nouveau = (filleul && filleul.nom) || 'le nouveau point';
    const parrain = maj[0].parrain_nom || 'le parrain';
    const montant = euros(PRIME_CENTS);
    await pushToAdmin(supabase, {
      title: `🎁 À verser — 1re location de ${nouveau}`,
      body: `${montant} à ${parrain} ET ${montant} à ${nouveau} (dossier ${resa.ref || resa.id}).`,
      tag: `parrainage-verser-${maj[0].id}`,
    }).catch(() => {});
    await sendBrevoEmail({
      to: process.env.CONTACT_EMAIL || 'contact@locair.fr',
      subject: `À verser — parrainage ${parrain} → ${nouveau}`,
      html: `<div style="font-family:Arial,sans-serif;color:#0E1726;max-width:560px">
<h2 style="color:#1A5EDB;margin:0 0 8px">Parrainage : 1re location faite</h2>
<p>Dossier <b>${esc(resa.ref || resa.id)}</b> payé : le nouveau point a fait sa 1re location.</p>
<p>À verser à la main, avec le prochain virement :</p>
<ul><li><b>${esc(montant)}</b> à ${esc(parrain)} (parrain)</li><li><b>${esc(montant)}</b> à ${esc(nouveau)} (nouveau point)</li></ul>
<p style="color:#4B5873;font-size:13px">Le site compte les 20 % habituels : ces versements sont en plus.</p></div>`,
      senderName: "Loc'Air Site",
    }).catch(() => {});
  } catch (e) {
    console.error('[parrainage 1re location]', e.message);
  }
}

module.exports = { detecterParrainage, premiereLocationParrainee };
