// Agent WhatsApp IA Loc'Air — Julie
// Répond à tous les messages avec Claude (conversationnel, avec mémoire par numéro).
//
// Variables d'env requises :
//   WHATSAPP_VERIFY_TOKEN    — jeton arbitraire copié dans la console Meta
//   WHATSAPP_ACCESS_TOKEN    — System User Token permanent
//   WHATSAPP_PHONE_NUMBER_ID — ID du numéro dans Meta Business Suite
//   WHATSAPP_APP_SECRET      — App Secret pour vérifier la signature HMAC
//   ANTHROPIC_API_KEY        — clé API Claude (déjà utilisée par admin-assistant)
//
// Optionnel :
//   WHATSAPP_IGNORE_PHONES   — numéros personnels à ignorer, séparés par des virgules
//                              ex: "33612345678,33698765432"
//                              → Julie ne leur répondra jamais
//   WHATSAPP_ALY_PHONE       — numéro WhatsApp d'Aly (ex: "33663798756") pour
//                              recevoir une notif quand Julie escalade un message

const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { callClaude }  = require('./_lib/anthropic');

// ── Système de prompt ──────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es Julie, l'assistante virtuelle de Loc'Air.
Loc'Air est un service de location de climatiseurs sur la Côte d'Azur (Nice, Cannes, Antibes, Monaco, Menton, Cagnes-sur-Mer).
Fondateur et contact principal : Aly Thiam — 06 63 79 87 56.
Horaires : 7j/7, 8h–20h.
Site : https://locair.fr

## Ton rôle
Répondre aux questions des clients sur WhatsApp de façon naturelle, chaleureuse et concise.
Tu parles toujours dans la langue du client (français, anglais, espagnol, russe, arabe, chinois…).
Tu ne dépasses jamais 3-4 phrases sauf si une liste ou un guide de dépannage est vraiment nécessaire.

## Produits et tarifs

### Climatiseur mobile
- Prix : à partir de **12 €/jour** (tarif dégressif : 9 €/j dès 7 jours, 8 €/j dès 21 jours)
- Frais de livraison et installation : **60 €** (aller + retour inclus)
- Puissance : 9 000 – 12 000 BTU · jusqu'à 15 m²
- Zéro perçage, zéro travaux · kit fenêtre inclus · installé en < 20 minutes
- Livraison J+1 ou Express 2 h selon dispo
- Durée minimum : 7 jours
- Réservation : https://locair.fr/reservation-climatiseur

### PortaSplit réversible A++
- **Avec engagement 6 mois** : 99 €/mois + 229 € à la souscription (installation offerte)
- **Sans engagement** (location courte durée) : 29 €/jour, à partir de 7 jours, livraison 30 €
- Puissance : 12 000 BTU · jusqu'à 42 m² · technologie inverter
- Réversible : chauffe l'hiver et refroidit l'été — même appareil
- Classe A++ · ultra-silencieux · pilotable par app mobile
- SAV inclus · résiliable sur justificatif de déménagement
- Réservation : https://locair.fr/reservation-portasplit

## Politique et garanties
- **Aucune caution** sur tous les produits
- Panne ou problème → technicien dépêché le **jour même ou le lendemain**
- Remplacement immédiat si l'appareil est défaillant
- Aucun engagement sur le climatiseur mobile (résiliable à tout moment)

## Guide de dépannage rapide (à utiliser si le client signale un problème)
1. **Gaine d'évacuation** : bien fixée et orientée vers l'extérieur ?
2. **Filtre** : retiré et nettoyé récemment ? Un filtre bouché divise la puissance par deux.
3. **Mode refroidissement ❄️** : sélectionné sur la télécommande (pas ventilation seule) ?
4. **Redémarrage** : éteindre, débrancher 30 secondes, rebrancher.
5. **Bac à condensats** : si l'appareil s'arrête seul, le bac est peut-être plein → utiliser le cordon de vidange à l'arrière.
Si le problème persiste après ces vérifications, dis au client qu'un technicien le rappellera dans les 2 heures — et termine ta réponse par [ESCALADE].

## Zone de service
Nice, Cannes, Antibes, Juan-les-Pins, Monaco, Menton, Cagnes-sur-Mer, Villeneuve-Loubet, Biot, Mougins, Valbonne.
Hors zone → expliquer gentiment qu'on ne livre pas encore là, et proposer de laisser ses coordonnées pour être informé d'une extension.

## Règles importantes
- Ne jamais inventer un prix, une date ou une disponibilité : si tu n'es pas sûre, dis "je vais vérifier avec l'équipe et te revenir rapidement".
- Pour une réservation concrète (date, lieu, quantité), diriger vers le formulaire en ligne ou proposer qu'Aly rappelle.
- Terminer chaque échange par une question d'aide ("Autre chose que je peux faire pour toi ?") sauf si le client vient de dire au revoir.
- Ne pas mentionner que tu es une IA sauf si le client te le demande directement — dans ce cas, répondre honnêtement.

## Quand escalader à Aly — OBLIGATOIRE dans ces 10 situations

Dans chacun de ces cas : réponds avec empathie, rassure le client ("je transmets ça à Aly en priorité, il te contacte sous peu"), puis termine ta réponse par [ESCALADE] (ce marqueur ne s'affiche pas au client, il alerte Aly en coulisse).

1. **Client en colère ou ton agressif** — toute frustration forte, insultes, impatience marquée
2. **Panne persistante** — le client a suivi le guide de dépannage et ça ne fonctionne toujours pas
3. **Demande de remboursement** — partiel ou total, peu importe la raison
4. **Demande d'annulation** — le client veut annuler sa réservation ou son abonnement
5. **Le client demande à parler à un humain** — "je veux parler à quelqu'un", "je veux Aly", etc.
6. **Réclamation / litige / menace juridique** — plainte, avis négatif menaçant, avocat, UFC, etc.
7. **Problème de livraison** — retard non expliqué, mauvaise adresse, technicien qui ne vient pas
8. **Problème de paiement ou de facturation** — paiement refusé, double débit, facture incorrecte
9. **Devis entreprise ou client professionnel** — plusieurs appareils, durée longue, tarif pro
10. **Situation ambiguë ou complexe** que tu ne sais pas gérer avec certitude`;

// ── Envoi de message WhatsApp ──────────────────────────────────────────────
async function sendReply(to, body) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token   = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneId || !token) {
    console.warn('[WA] WHATSAPP_PHONE_NUMBER_ID ou WHATSAPP_ACCESS_TOKEN manquant');
    return;
  }
  // Découper les messages trop longs (limite WhatsApp : 4096 caractères)
  const chunks = [];
  for (let i = 0; i < body.length; i += 4000) chunks.push(body.slice(i, i + 4000));
  for (const chunk of chunks) {
    const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: chunk },
      }),
    });
    if (!r.ok) console.error('[WA send]', r.status, await r.text());
  }
}

// ── Filtres : numéros ignorés + opt-out STOP ──────────────────────────────

// Numéros personnels à ignorer (var d'env Vercel, séparés par des virgules)
function isIgnored(phone) {
  const list = (process.env.WHATSAPP_IGNORE_PHONES || '')
    .split(',').map(n => n.trim()).filter(Boolean);
  return list.includes(phone);
}

// Opt-out : si le message est "STOP" ou "ARRÊT", on ajoute le numéro en base
async function handleOptOut(supabase, phone) {
  await supabase.from('whatsapp_opt_out').upsert({ phone }, { onConflict: 'phone' });
  await sendReply(phone, "Compris 🙏 Je ne vous répondrai plus automatiquement. Pour reprendre, écrivez START.");
}

async function isOptedOut(supabase, phone) {
  try {
    const { data } = await supabase
      .from('whatsapp_opt_out').select('phone').eq('phone', phone).maybeSingle();
    return !!data;
  } catch { return false; }
}

async function handleOptIn(supabase, phone) {
  await supabase.from('whatsapp_opt_out').delete().eq('phone', phone);
  await sendReply(phone, "Bonjour ! Julie est de retour 👋 Comment puis-je vous aider ?");
}

// ── Lookup réservation par numéro WhatsApp ────────────────────────────────
// Convertit "33612345678" → "0612345678" pour matcher le tel en base
function waPhoneToFr(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('33') && digits.length === 11) return '0' + digits.slice(2);
  return digits;
}

async function lookupReservation(supabase, fromPhone) {
  try {
    const frPhone = waPhoneToFr(fromPhone);
    if (!frPhone || frPhone.length < 9) return null;
    const last9 = frPhone.slice(-9); // "612345678"
    const { data } = await supabase
      .from('reservations')
      .select('ref, prenom, statut, statut_detaille, date_debut, date_fin, adresse')
      .ilike('tel', `%${last9}%`)
      .in('statut', ['en_attente', 'confirmee'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data || null;
  } catch { return null; }
}

// ── Notification à Aly quand Julie escalade ────────────────────────────────
// Julie ajoute [ESCALADE] à la fin de sa réponse quand elle doit alerter Aly.
// Ce marqueur est retiré avant l'envoi au client.

function extractEscalation(text) {
  const marker = '[ESCALADE]';
  const idx    = (text || '').indexOf(marker);
  if (idx === -1) return { reply: text, escalate: false };
  return {
    reply:    text.slice(0, idx).trimEnd(),
    escalate: true,
  };
}

async function notifyAly(fromPhone, userText, motif) {
  const alyPhone = (process.env.WHATSAPP_ALY_PHONE || '').trim();
  if (!alyPhone) return;
  const preview = (userText || '').slice(0, 150);
  const msg = `📲 *Escalade Julie*\n\n*Client :* wa.me/${fromPhone}\n*Message :* "${preview}"\n\n_Réponds directement à ce numéro_ 👆`;
  await sendReply(alyPhone, msg);
}

// ── Mémoire conversationnelle ──────────────────────────────────────────────
const MAX_MESSAGES = 20; // garder les 20 derniers échanges (10 tours)

async function loadHistory(supabase, phone) {
  try {
    const { data } = await supabase
      .from('whatsapp_conversations')
      .select('messages')
      .eq('phone', phone)
      .maybeSingle();
    return data?.messages || [];
  } catch {
    return [];
  }
}

async function saveHistory(supabase, phone, messages) {
  const trimmed = messages.slice(-MAX_MESSAGES);
  try {
    await supabase.from('whatsapp_conversations').upsert({
      phone,
      messages:   trimmed,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone' });
  } catch (e) {
    console.error('[WA history save]', e.message);
  }
}

// ── Agent Claude ───────────────────────────────────────────────────────────
async function agentReply(supabase, from, userText) {
  const [history, resa] = await Promise.all([
    loadHistory(supabase, from),
    lookupReservation(supabase, from),
  ]);

  // Injecter la réservation active dans le contexte si elle existe
  let systemWithContext = SYSTEM_PROMPT;
  if (resa) {
    const statuts = {
      en_attente:'en attente de confirmation', confirmee:'confirmée',
      livraison_prevue:'livraison prévue', en_location:'en cours de location',
      retour_prevu:'retour prévu',
    };
    const label = statuts[resa.statut_detaille || resa.statut] || resa.statut;
    systemWithContext += `\n\n## Réservation active de ce client\n- Référence : ${resa.ref}\n- Prénom : ${resa.prenom || '(non renseigné)'}\n- Statut : ${label}\n- Dates : du ${resa.date_debut} au ${resa.date_fin}\n- Adresse : ${resa.adresse || '(non renseignée)'}\n\nTu peux mentionner ces informations si le client pose une question sur sa commande.`;
  }

  const messages = [
    ...history,
    { role: 'user', content: userText },
  ];

  const result = await callClaude({
    system:    systemWithContext,
    messages,
    maxTokens: 600,
  });

  if (!result.ok) {
    console.error('[WA agent]', result.error);
    return 'Bonjour ! Je rencontre un souci technique. Merci de contacter Aly directement au 06 63 79 87 56 — il vous répondra dans les meilleurs délais. 🙏';
  }

  const raw = result.data?.content?.[0]?.text || '';

  // Détecter et retirer le marqueur d'escalade
  const { reply, escalate } = extractEscalation(raw);

  // Sauvegarder l'échange dans la mémoire (sans le marqueur)
  await saveHistory(supabase, from, [
    ...messages,
    { role: 'assistant', content: reply },
  ]);

  // Notifier Aly si Julie a escaladé
  if (escalate) {
    notifyAly(from, userText).catch(e => console.error('[WA escalade]', e.message));
  }

  return reply;
}

// ── Handler Vercel ─────────────────────────────────────────────────────────
const handler = async (req, res) => {
  // Vérification webhook Meta (GET)
  if (req.method === 'GET') {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  // Lire le body brut pour la vérification de signature
  const rawBody = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  // Vérification HMAC de la signature Meta
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return res.status(403).send('Forbidden');
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return res.status(403).send('Forbidden');
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.status(403).send('Forbidden');
    }
  } catch {
    return res.status(403).send('Forbidden');
  }

  try {
    const payload = JSON.parse(rawBody.toString());
    if (payload?.object !== 'whatsapp_business_account') return res.status(200).send('OK');

    const supabase = getSupabase();

    for (const entry of payload?.entry || []) {
      for (const change of entry?.changes || []) {
        if (change?.field !== 'messages') continue;

        for (const msg of change?.value?.messages || []) {
          // Ignorer tout ce qui n'est pas du texte (images, vocaux, etc.)
          if (msg.type !== 'text') continue;
          const text = msg.text?.body?.trim();
          if (!text) continue;
          const from = msg.from;

          // Numéros personnels ignorés (var d'env)
          if (isIgnored(from)) continue;

          // Déduplication : ne répondre qu'une seule fois au même message
          const { error: insertError } = await supabase
            .from('whatsapp_messages_vus')
            .insert({ msg_id: msg.id });
          if (insertError) continue; // message déjà traité (duplicate key)

          const textUp = text.toUpperCase().trim();

          // Commande STOP → opt-out
          if (textUp === 'STOP' || textUp === 'ARRÊT' || textUp === 'ARRET') {
            await handleOptOut(supabase, from);
            continue;
          }

          // Commande START → opt-in
          if (textUp === 'START' || textUp === 'REPRENDRE') {
            await handleOptIn(supabase, from);
            continue;
          }

          // Vérifier opt-out Supabase
          if (await isOptedOut(supabase, from)) continue;

          // Répondre avec l'agent IA
          const reply = await agentReply(supabase, from, text);
          if (reply) await sendReply(from, reply);
        }
      }
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('[WA webhook]', err.message);
    return res.status(200).send('OK');
  }
};

handler.config = { api: { bodyParser: false } };
module.exports = handler;
