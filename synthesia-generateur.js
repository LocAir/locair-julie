#!/usr/bin/env node
// Outil en ligne de commande pour fabriquer des vidéos Synthesia depuis le
// dépôt — c'est par lui que Claude (ou le propriétaire) parle à Synthesia.
// Même esprit que blog-generateur.py / villes-generateur.py : un script à la
// racine, lancé à la main, qui produit un fichier.
//
// La clé se lit dans SYNTHESIA_API_KEY (variable d'environnement ou fichier
// .env à la racine, jamais commité). Mode d'emploi complet : SYNTHESIA.md
//
//   node synthesia-generateur.js avatars
//   node synthesia-generateur.js creer --titre "Ouvrir le boxe" --fichier script.txt --format 9:16 --attendre --sortie videos/tuto-boxe.mp4
//   node synthesia-generateur.js statut <id> [--attendre] [--sortie fichier.mp4]
//   node synthesia-generateur.js liste
//
// Par défaut toute vidéo est créée en mode ESSAI : filigranée, gratuite,
// aucun crédit consommé. Il faut ajouter --reel pour dépenser un crédit.
const fs   = require('fs');
const path = require('path');

// Petit lecteur de .env : le propriétaire n'a pas à savoir exporter une
// variable d'environnement dans son terminal, un fichier .env suffit.
// Volontairement minimal (pas de dépendance) : LIGNE = valeur, # en commentaire.
function chargerEnvLocal() {
  const fichier = path.join(__dirname, '.env');
  if (!fs.existsSync(fichier)) return;
  for (const ligne of fs.readFileSync(fichier, 'utf8').split('\n')) {
    const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const valeur = m[2].replace(/^["']|["']$/g, '');
    if (!process.env[m[1]]) process.env[m[1]] = valeur;
  }
}
chargerEnvLocal();

const { creerVideo, statutVideo, listerVideos, listerAvatars, attendreVideo } = require('./api/_lib/synthesia');

function lireOptions(argv) {
  const opts = {};
  const libres = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const cle = a.slice(2);
      const suivant = argv[i + 1];
      if (suivant && !suivant.startsWith('--')) { opts[cle] = suivant; i++; }
      else opts[cle] = true;
    } else libres.push(a);
  }
  return { opts, libres };
}

// Le lien de téléchargement renvoyé par Synthesia expire : on enregistre le
// fichier tout de suite plutôt que de garder l'URL quelque part.
async function telecharger(url, destination) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Téléchargement impossible (${r.status})`);
  const dossier = path.dirname(destination);
  if (dossier && dossier !== '.') fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(destination, Buffer.from(await r.arrayBuffer()));
  const ko = Math.round(fs.statSync(destination).size / 1024);
  console.log(`Vidéo enregistrée : ${destination} (${ko} Ko)`);
}

function aide() {
  console.log(`Fabriquer des vidéos Synthesia depuis le dépôt.

  node synthesia-generateur.js avatars
      La liste des avatars du compte, avec leur identifiant.

  node synthesia-generateur.js creer --titre "..." --texte "..." [options]
  node synthesia-generateur.js creer --titre "..." --fichier script.txt [options]
      --format 16:9 | 9:16 | 1:1 | 4:5   (défaut 16:9)
      --avatar <id>        avatar précis (défaut : SYNTHESIA_AVATAR_ID)
      --fond <nom>         fond précis   (défaut : SYNTHESIA_BACKGROUND)
      --reel               dépense un crédit et retire le filigrane
      --attendre           attend la fin du rendu (plusieurs minutes)
      --sortie <fichier>   enregistre la vidéo (implique --attendre)

  node synthesia-generateur.js statut <id> [--attendre] [--sortie fichier.mp4]
  node synthesia-generateur.js liste

Clé attendue dans SYNTHESIA_API_KEY (variable d'environnement ou .env).
Mode d'emploi complet : SYNTHESIA.md`);
}

// Sortie d'erreur unique : un message en français, et un code de sortie 1
// pour qu'un enchaînement de commandes s'arrête vraiment sur l'échec.
function echec(message) {
  console.error(`Échec : ${message}`);
  process.exit(1);
}

async function main() {
  const { opts, libres } = lireOptions(process.argv.slice(2));
  const commande = libres[0] || (opts.aide || opts.help ? 'aide' : '');

  if (!commande || commande === 'aide') return aide();

  if (commande === 'avatars') {
    const r = await listerAvatars();
    if (!r.ok) return echec(r.error);
    if (!r.avatars.length) return console.log('Aucun avatar renvoyé par le compte.');
    for (const a of r.avatars) {
      console.log(`${a.id || a.avatar_id || '?'}  —  ${a.name || a.avatar_name || ''}`);
    }
    return;
  }

  if (commande === 'liste') {
    const r = await listerVideos({ limit: opts.limite || 20 });
    if (!r.ok) return echec(r.error);
    if (!r.videos.length) return console.log('Aucune vidéo sur le compte.');
    for (const v of r.videos) {
      console.log(`${v.id}  ${String(v.status || '').padEnd(12)}  ${v.title || ''}`);
    }
    return;
  }

  if (commande === 'creer') {
    let texte = opts.texte && opts.texte !== true ? opts.texte : '';
    if (opts.fichier && opts.fichier !== true) {
      if (!fs.existsSync(opts.fichier)) return echec(`Fichier introuvable : ${opts.fichier}`);
      texte = fs.readFileSync(opts.fichier, 'utf8');
    }
    if (!texte.trim()) return echec('Il faut --texte "..." ou --fichier script.txt');

    const r = await creerVideo({
      titre:  opts.titre !== true ? opts.titre : undefined,
      texte,
      avatar: opts.avatar !== true ? opts.avatar : undefined,
      fond:   opts.fond   !== true ? opts.fond   : undefined,
      format: opts.format !== true ? opts.format : undefined,
      test:   !opts.reel,
    });
    if (!r.ok) return echec(r.error);
    console.log(`Vidéo lancée : ${r.id}`);
    console.log(r.test
      ? 'Mode essai : gratuit, filigrané. Ajouter --reel pour la version finale.'
      : 'Mode réel : un crédit du forfait est consommé.');
    if (!opts.attendre && !opts.sortie) {
      console.log(`Suivre le rendu : node synthesia-generateur.js statut ${r.id} --attendre`);
      return;
    }
    return suivre(r.id, opts);
  }

  if (commande === 'statut') {
    const id = libres[1];
    if (!id) return echec('Il faut l\'identifiant : statut <id>');
    if (opts.attendre || opts.sortie) return suivre(id, opts);
    const r = await statutVideo(id);
    if (!r.ok) return echec(r.error);
    console.log(`Statut : ${r.statut}`);
    if (r.download) console.log(`Lien (temporaire) : ${r.download}`);
    return;
  }

  echec(`Commande inconnue : ${commande}`);
}

async function suivre(id, opts) {
  console.log('Rendu en cours — compter 2 à 5 minutes.');
  let dernier = '';
  const r = await attendreVideo(id, {
    onTick: (etat) => {
      if (etat.statut !== dernier) { dernier = etat.statut; console.log(`  ${etat.statut}`); }
    },
  });
  if (!r.ok) return echec(r.error);
  console.log('Vidéo prête.');
  if (opts.sortie && opts.sortie !== true) {
    if (!r.download) return echec('Vidéo prête mais aucun lien de téléchargement renvoyé.');
    await telecharger(r.download, opts.sortie);
  } else if (r.download) {
    console.log(`Lien (temporaire) : ${r.download}`);
  }
}

main().catch((e) => echec(e.message));
