/* ═══════════════════════════════════════════════════════════════════════
   LOC'AIR — LE SCRIPT DE LA BOUTIQUE

   Trois choses, et rien d'autre :
     1. lire le retour de la page de paiement (?achat=confirme|annule) ;
     2. demander à /api/produits-vente ce qui est réellement en vente et
        en dessiner les fiches ;
     3. envoyer l'identifiant du modèle et la ville à
        /api/boutique-checkout, puis suivre l'adresse que Stripe renvoie.

   ── CE QU'IL NE FAIT JAMAIS ──
   · Il n'écrit aucun prix, aucun modèle, aucun délai qui ne vienne pas de
     l'API. S'il n'y a rien à vendre, rien ne s'affiche et le message écrit
     dans le HTML reste — jamais une étagère vide, jamais un prix inventé.
   · Il n'envoie jamais de montant. Le serveur relit le prix dans le
     catalogue. Un montant qui passerait par ici serait modifiable en trois
     secondes avec les outils du navigateur.
   · Il ne construit rien avec innerHTML à partir de données. Un nom de
     modèle saisi dans l'admin est du texte, pas du HTML.

   ── SI LE SCRIPT NE PART PAS ──
   Pas de JavaScript, pas de réseau, une API muette : la page reste lisible
   et propose d'appeler. C'est l'état écrit en dur dans le HTML, et c'est
   volontairement lui l'état par défaut.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* Les deux seules villes. La même liste est revérifiée côté serveur
     (api/boutique-checkout.js) : un <select> se contourne, pas une
     validation serveur. */
  var VILLES = ['Nice', 'Paris'];

  var NBSP = '\u00A0';

  function $(id) { return document.getElementById(id); }

  function el(nom, classe, texte) {
    var n = document.createElement(nom);
    if (classe) n.className = classe;
    if (texte != null) n.textContent = texte;
    return n;
  }

  /* Un prix, à la française, avec une espace INSÉCABLE avant l'euro : sans
     elle, « 499 » peut finir en bas d'une ligne et « € » en haut de la
     suivante. */
  function eur(cents) {
    return (Math.round(cents) / 100).toLocaleString('fr-FR', {
      minimumFractionDigits: 0, maximumFractionDigits: 2
    }) + NBSP + '€';
  }

  /* ── 1. LE RETOUR DE LA PAGE DE PAIEMENT ─────────────────────────────
     Stripe nous renvoie sur /boutique?achat=confirme ou ?achat=annule.
     Deux messages très différents, et surtout : annuler n'est pas une
     erreur. Quelqu'un qui a fait demi-tour ne doit pas trouver du rouge en
     revenant.
     L'adresse est nettoyée derrière : rechargée ou partagée, la page ne
     doit pas rejouer « merci pour votre commande ». */
  function retour() {
    var boite = $('retour'), texte = $('retour-t');
    if (!boite || !texte) return;

    var etat = null;
    try {
      etat = new URLSearchParams(location.search).get('achat');
    } catch (e) { return; }
    if (etat !== 'confirme' && etat !== 'annule') return;

    var ok = etat === 'confirme';
    texte.className = 'b-retour' + (ok ? ' paye' : '');
    texte.appendChild(el('b', null, ok
      ? 'C’est payé. Merci\u00A0!'
      : 'Vous avez interrompu le paiement.'));
    var ligne = el('span', null, ok
      ? 'Vous recevez le reçu par courriel. Nous préparons la machine et '
      + 'vous écrivons dès qu’elle part — le suivi Chronopost arrive avec. '
      + 'Une question d’ici là\u00A0: '
      : 'Rien n’a été débité et votre panier n’existe plus\u00A0: il suffit '
      + 'de reprendre ci-dessous. Si quelque chose vous a arrêté, '
      + 'dites-le-nous au ');
    /* Le numéro est cliquable : sur un téléphone, un numéro qu’il faut
       recopier à la main n’est pas un numéro. */
    var tel = el('a', null, '06.63.79.87.56');
    tel.href = 'tel:+33663798756';
    ligne.appendChild(tel);
    ligne.appendChild(document.createTextNode('.'));
    texte.appendChild(ligne);
    boite.hidden = false;

    if (window.history && history.replaceState) {
      history.replaceState(null, '', location.pathname);
    }
  }

  /* ── 2. LES FICHES ───────────────────────────────────────────────────── */

  var liste = $('b-liste'), vide = $('b-vide'), err = $('b-err');

  function erreur(msg) {
    if (!err) return;
    err.textContent = msg;
    err.hidden = false;
  }

  /* Ce qui est compris. Écrit à partir de ce que la fiche contient
     vraiment : pas de garantie fabricant dans le catalogue, pas de ligne
     « garantie fabricant ». Promettre une garantie qu'on n'a pas notée,
     c'est promettre pour de vrai. */
  function compris(p, ville) {
    var ul = el('ul', 'b-c'), lignes = [];

    /* Avant que la ville soit choisie, la ligne dit les deux — c'est vrai,
       et ça évite que la fiche change de hauteur au moment du choix. */
    lignes.push(['Livraison offerte',
      ville ? 'par Chronopost, à ' + ville + '.' : 'par Chronopost, à Nice ou à Paris.']);

    if (typeof p.delai_vente_jours === 'number') {
      lignes.push([
        p.delai_vente_jours === 0 ? 'Expédié le jour même'
          : 'Sous ' + p.delai_vente_jours + (p.delai_vente_jours > 1 ? ' jours' : ' jour'),
        'après la commande.'
      ]);
    }
    if (typeof p.garantie_fabricant_mois === 'number' && p.garantie_fabricant_mois > 0) {
      lignes.push([p.garantie_fabricant_mois + ' mois de garantie fabricant',
        'en plus des 2 ans de garantie légale.']);
    } else {
      lignes.push(['2 ans de garantie légale', 'c’est nous, le vendeur, qui en répondons.']);
    }
    lignes.push(['14 jours pour changer d’avis', 'à compter de la réception.']);

    lignes.forEach(function (l) {
      var li = document.createElement('li');
      li.appendChild(el('b', null, l[0]));
      li.appendChild(document.createTextNode(' ' + l[1]));
      ul.appendChild(li);
    });
    return ul;
  }

  function fiche(p, i) {
    var c = el('div', 'b-carte');
    var nom = [p.marque, p.modele].filter(Boolean).join(' ');
    var idv = 'b-ville-' + i;

    c.appendChild(el('div', 'b-nom', nom));

    var spec = [
      p.puissance_btu ? p.puissance_btu + NBSP + 'BTU' : null,
      p.surface_max_m2 ? 'jusqu’à ' + p.surface_max_m2 + NBSP + 'm²' : null,
      p.niveau_sonore_db ? p.niveau_sonore_db + NBSP + 'dB' : null,
      p.classe_energie ? 'classe ' + p.classe_energie : null
    ].filter(Boolean).join(' · ');
    c.appendChild(el('div', 'b-spec', spec || 'Le modèle que nous louons aussi.'));

    c.appendChild(el('div', 'b-prix', eur(p.prix_vente_cents)));
    c.appendChild(el('p', 'b-ttc', 'Prix TTC, livraison comprise. Rien ne s’ajoute au moment de payer.'));

    /* La liste « ce qui est compris » dépend de la ville choisie : on la
       redessine à chaque changement plutôt que d'écrire « à Nice ou à
       Paris », qui ne dit rien à personne. */
    var zoneC = el('div');
    c.appendChild(zoneC);

    var bloc = el('div', 'b-ville');
    /* Un vrai <label for>, pas un simple titre : sans lui, un lecteur
       d'écran annonce « liste déroulante » sans dire de quoi. */
    var lab = el('label', null, 'Livraison à');
    lab.setAttribute('for', idv);
    bloc.appendChild(lab);

    var sel = el('select', 'b-sel');
    sel.id = idv;
    var vide0 = el('option', null, 'Choisissez votre ville…');
    vide0.value = '';
    sel.appendChild(vide0);
    VILLES.forEach(function (v) {
      var o = el('option', null, v);
      o.value = v;
      sel.appendChild(o);
    });
    bloc.appendChild(sel);

    var btn = el('button', 'btn btn-1', 'Choisissez votre ville');
    btn.type = 'button';
    btn.disabled = true;
    bloc.appendChild(btn);

    /* Les conditions de vente sont LISIBLES AVANT de payer, pas remises
       après. C'est ce que la loi demande pour une vente à distance, et
       c'est aussi la seule version honnête : on ne fait pas signer un
       document qu'on montre ensuite. */
    var note = el('p', 'b-note',
      'Paiement par carte, sur la page sécurisée de Stripe. '
      + 'L’adresse exacte se saisit à l’étape suivante. En achetant, vous '
      + 'acceptez nos ');
    var cgv = el('a', null, 'conditions de vente');
    cgv.href = '/cgv-vente';
    note.appendChild(cgv);
    note.appendChild(document.createTextNode('.'));
    bloc.appendChild(note);
    c.appendChild(bloc);

    function dessineCompris() {
      zoneC.textContent = '';
      zoneC.appendChild(compris(p, sel.value));
    }
    /* Le texte du bouton fait le travail que ferait un message d'erreur :
       tant qu'aucune ville n'est choisie, il DIT ce qu'il attend, au lieu de
       rester sur « Acheter » et de ne rien faire quand on clique. */
    function dessineBouton() {
      btn.disabled = !sel.value;
      btn.textContent = sel.value
        ? 'Acheter et faire livrer à ' + sel.value
        : 'Choisissez votre ville';
    }
    sel.addEventListener('change', function () {
      dessineBouton();
      dessineCompris();
      if (err) err.hidden = true;
    });
    dessineBouton();
    dessineCompris();

    btn.addEventListener('click', function () { acheter(p, sel, btn); });

    return c;
  }

  /* ── 3. LE PAIEMENT ───────────────────────────────────────────────────
     On n'envoie qu'un identifiant et une ville. Le serveur relit le prix.
     Le bouton se verrouille pendant l'aller-retour : deux clics rapides
     créeraient deux sessions de paiement, donc potentiellement deux
     commandes pour un seul client. */
  function acheter(p, sel, btn) {
    if (!sel.value) { sel.focus(); return; }
    if (btn.getAttribute('aria-busy') === 'true') return;

    var avant = btn.textContent;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Un instant…';
    if (err) err.hidden = true;

    function rendreBouton() {
      btn.removeAttribute('aria-busy');
      btn.textContent = avant;
    }

    fetch('/api/boutique-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ modele_id: p.id, ville: sel.value })
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; })
          .then(function (d) { return { ok: r.ok, d: d }; });
      })
      .then(function (res) {
        if (res.ok && res.d && res.d.url) {
          /* On quitte la page : le bouton reste volontairement verrouillé,
             sinon il redevient cliquable pendant le chargement de Stripe. */
          location.href = res.d.url;
          return;
        }
        rendreBouton();
        erreur((res.d && res.d.error)
          || 'Le paiement n’a pas pu démarrer. Réessayez, ou appelez-nous au 06.63.79.87.56.');
      })
      .catch(function () {
        rendreBouton();
        erreur('Connexion interrompue. Réessayez, ou appelez-nous au 06.63.79.87.56.');
      });
  }

  function charger() {
    if (!liste || !window.fetch) return;   /* le HTML dit déjà quoi faire */

    fetch('/api/produits-vente', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var produits = (d && Array.isArray(d.produits) ? d.produits : [])
          .filter(function (p) { return p && p.id && p.prix_vente_cents > 0; })
          /* Deux fiches au maximum. Au-delà, ce n'est plus un choix, c'est
             un rayon de supermarché — et ce n'est pas ce qu'on vend. */
          .slice(0, 2);

        if (!produits.length) return;      /* le message écrit reste */

        liste.textContent = '';
        produits.forEach(function (p, i) { liste.appendChild(fiche(p, i)); });
        liste.hidden = false;
        if (vide) vide.hidden = true;
      })
      .catch(function () { /* le message écrit reste */ });
  }

  retour();
  charger();
})();
