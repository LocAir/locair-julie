#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fabrique les pages de ville (/location-climatiseur-<ville>).

Le contenu est dans villes_contenu.py ; les morceaux communs à toutes les
pages de texte dans locair_gabarit.py.

SUR LES DONNÉES STRUCTURÉES — le point qui compte pour Google :
  Loc'Air n'a PAS d'établissement à Cannes, Antibes, Monaco ni Menton. Ces
  pages déclarent donc un Service rendu depuis Nice, avec areaServed = la
  ville — et surtout PAS un LocalBusiness par ville avec une fausse adresse.
  C'est l'erreur classique des pages de ville, et Google la sanctionne.
"""
import os, re, html
from locair_gabarit import (BASE, DATE_ISO, DATE_FR, EDITEUR, bar, pied,
                            SCRIPT_BAR, tete_html, partage, jsonld,
                            minutes, sommaire, typo_fr)
from villes_contenu import VILLES, LIVRAISON, DEUX_SEMAINES, TOTAL_2SEM

PAR_SLUG = {v['slug']: v for v in VILLES}

def url_de(slug):
    return f"{BASE}/location-climatiseur-{slug}"

def bloc_prix(v):
    n = v['nom']
    return f"""<h2 id="prix">Combien ça coûte à {n}</h2>
<p>Le tarif de location est le même que partout&nbsp;: dégressif <b>par tranches</b>, c'est-à-dire que les premiers jours restent au tarif du haut et que seuls les jours suivants passent au tarif inférieur.</p>
<div class="tab">
<table>
  <thead><tr><th scope="col">Durée</th><th scope="col">Prix du jour</th></tr></thead>
  <tbody>
    <tr><th scope="row">Les 7 premiers jours</th><td><b>12 €</b> par jour</td></tr>
    <tr><th scope="row">Du 8ᵉ au 14ᵉ jour</th><td><b>10 €</b> par jour</td></tr>
    <tr><th scope="row">Du 15ᵉ au 21ᵉ jour</th><td><b>9 €</b> par jour</td></tr>
    <tr><th scope="row">À partir du 22ᵉ jour</th><td><b>8 €</b> par jour</td></tr>
  </tbody>
</table>
</div>
<p>Ce qui change à {n}, c'est <b>la livraison&nbsp;: {LIVRAISON} €</b> au lieu de 60 €. Notre dépôt est à Nice, à une trentaine de minutes de route&nbsp;: c'est ce trajet-là que vous payez, aller <b>et</b> retour — nous venons reprendre l'appareil à la fin, c'est déjà compté.</p>
<div class="chif">
  <b>{TOTAL_2SEM} €</b>
  <span>Deux semaines complètes à {n}&nbsp;: {DEUX_SEMAINES} € de location plus {LIVRAISON} € de livraison et récupération. Sans caution. Ajoutez 80 € si vous voulez qu'un technicien pose l'appareil — sinon la pose libre est offerte.</span>
</div>
<p>La durée minimale est de 7 jours. Le détail complet, tranche par tranche, est dans <a href="/blog/prix-location-climatiseur-mobile-nice">notre guide des prix</a>.</p>"""

BLOC_COMPRIS = """<h2 id="compris">Ce qui est compris, et ce qui ne l'est pas</h2>
<ul>
  <li><b>Le kit de calfeutrage, fourni et posé.</b> C'est la pièce qui bouche la fenêtre autour de la gaine — sans elle, l'appareil tourne pour rien. Ni perçage, ni trace au retrait.</li>
  <li><b>La récupération</b> le dernier jour. Rien à rapporter nulle part.</li>
  <li><b>Le remplacement en cas de panne</b>, sans frais. Si la réparation sur place n'est pas possible, nous échangeons l'appareil ou nous remboursons les jours restants. C'est dans le contrat.</li>
  <li><b>L'assistance 7j/7</b>, de 8h à 20h.</li>
  <li><b>Aucune caution.</b> Ni chèque, ni empreinte bancaire, ni blocage sur la carte. Jamais.</li>
  <li><b>L'annulation est gratuite</b> tant que la livraison n'a pas eu lieu.</li>
</ul>
<p>Ce qui n'est pas compris&nbsp;: l'électricité, la seule dépense qui ne passe pas par nous. Comptez 1,00 € à 1,70 € pour une nuit de 8 heures selon le réglage — l'appareil que nous louons est en classe A+++, la meilleure de la catégorie.</p>"""

def bloc_deroule(v):
    return f"""<h2 id="deroule">Comment ça se passe</h2>
<ul>
  <li><b>Vous réservez en ligne</b> avec votre adresse à {v['nom']} et vos dates. Le montant est affiché avant le paiement, et reconfirmé au moment de payer.</li>
  <li><b>Nous vous appelons le matin de la livraison</b> pour confirmer le créneau.</li>
  <li><b>Le technicien monte l'appareil</b>, pose le kit sur votre fenêtre, vérifie que l'air qui sort est froid et vous montre les réglages — dont le mode silencieux, si c'est pour une chambre. Vingt à trente minutes, et vous n'avez rien à préparer.</li>
  <li><b>Le dernier jour, nous revenons tout chercher.</b> Si vous voulez garder l'appareil plus longtemps, la prolongation se fait en quelques clics depuis votre espace client, et le tarif s'ajuste tout seul.</li>
</ul>"""

def bloc_quartiers(v):
    pastilles = ''.join(f'<span>{q}</span>' for q in v['quartiers'])
    return f"""<h2 id="quartiers">Où nous livrons à {v['nom']}</h2>
<p>Toute la commune, code postal {v['cp']}. Les quartiers qui reviennent le plus&nbsp;:</p>
<div class="qrt">{pastilles}</div>
<p>Si votre adresse n'apparaît pas dans la recherche du site, écrivez-nous&nbsp;: nous livrons plus large que ce que la liste laisse croire.</p>"""

def bloc_machine(v):
    return f"""<h2 id="machine">Climatiseur ou rafraîchisseur&nbsp;? La fenêtre décide</h2>
<p>Nous louons deux machines, et ce n'est pas la même selon la pièce.</p>
<div class="tab">
<table>
  <thead><tr><th scope="col">Votre pièce</th><th scope="col">La machine</th></tr></thead>
  <tbody>
    <tr><th scope="row">Fermée — chambre, salon, bureau</th><td><b>Climatiseur mobile.</b> Du vrai froid, et l'humidité qui baisse.</td></tr>
    <tr><th scope="row">Ouverte — terrasse, garage, atelier, véranda</th><td><b>Rafraîchisseur d'air.</b> De l'eau qui s'évapore, sans gaine à la fenêtre.</td></tr>
  </tbody>
</table>
</div>
<p>Le détail est dans <a href="/blog/climatiseur-mobile-ou-rafraichisseur-air">notre guide&nbsp;: climatiseur mobile ou rafraîchisseur d'air</a>. En cas de doute, une photo de la pièce sur WhatsApp suffit.</p>

<h2 id="pro">Pour un commerce ou un événement à {v['nom']}</h2>
<p>Un magasin dont l'entrée reste ouverte, une terrasse de restaurant, un atelier, un chapiteau&nbsp;: un climatiseur n'y peut rien, il refroidit la rue. C'est le rafraîchisseur adiabatique qu'il faut, et le chiffrage se fait après avoir vu le volume et les ouvertures — <a href="/pro">demander un devis Loc'Air Pro</a>.</p>"""

def faq_de(v):
    n = v['nom']
    return [
      (f"Loc'Air livre-t-il vraiment à {n} ?",
       f"Oui. Nous sommes basés à Nice et {n} est en zone hors standard : la livraison est facturée {LIVRAISON} € au lieu de 60 €, aller et retour compris. Le reste ne change pas — même appareil, même équipe, même contrat."),
      (f"Combien coûte la location d'un climatiseur mobile à {n} ?",
       f"Le tarif est dégressif : 12 € par jour la première semaine, 10 € du 8ᵉ au 14ᵉ jour, 9 € du 15ᵉ au 21ᵉ, 8 € à partir du 22ᵉ. Avec {LIVRAISON} € de livraison, deux semaines à {n} reviennent à {TOTAL_2SEM} €."),
      ("Faut-il verser une caution ?",
       "Non. Aucun chèque de caution, aucune empreinte bancaire, aucun blocage sur votre carte. Vous payez la location, rien d'autre."),
      ("Faut-il percer un mur pour installer l'appareil ?",
       "Non. Le kit de calfeutrage se fixe sur le cadre de la fenêtre et se retire sans perçage ni trace, ce qui le rend compatible avec une location ou un Airbnb. Il est fourni et posé."),
      ("Quel type de fenêtre est compatible ?",
       "Oscillo-battante, coulissante, guillotine, Velux : dans la quasi-totalité des cas, oui. Baie vitrée avec grille : au cas par cas, une photo sur WhatsApp suffit. Le technicien apporte toujours le matériel adapté."),
    ]

def bloc_faq(faq):
    """Les questions sont ÉCRITES SUR LA PAGE, pas seulement dans les données
       structurées : Google exige que ce qu'on lui déclare soit visible."""
    out = ['<h2 id="questions">Questions fréquentes</h2>']
    for q, r in faq:
        out.append(f'<h3>{q}</h3>\n<p>{r}</p>')
    return '\n'.join(out)

def page_ville(v):
    url = url_de(v['slug'])
    faq = faq_de(v)
    corps = '\n\n'.join([
        v['contexte'].strip(),
        bloc_prix(v), BLOC_COMPRIS, bloc_deroule(v),
        bloc_quartiers(v), bloc_machine(v), bloc_faq(faq)])
    som = sommaire(corps, "Sur cette page")

    ld = [
      {"@context":"https://schema.org","@type":"Service",
       "@id": url + "#service",
       "name": v['titre_seo'],
       "description": v['desc'],
       "serviceType":"Location de climatiseurs mobiles et de rafraîchisseurs d'air adiabatiques",
       # Le prestataire est l'entreprise niçoise — une seule, pas une par ville.
       "provider": {"@type":"LocalBusiness","@id": BASE + "/#business","name":"Loc'Air",
                    "url": BASE + "/","telephone":"+33663798756",
                    "address":{"@type":"PostalAddress","streetAddress":"11 Avenue Chantal",
                               "postalCode":"06100","addressLocality":"Nice","addressCountry":"FR"}},
       "areaServed": {"@type":"City","name": v['nom']},
       "url": url,
       "offers": {"@type":"Offer","priceCurrency":"EUR","price":"12",
                  "priceSpecification":{"@type":"UnitPriceSpecification",
                      "priceCurrency":"EUR","price":"12",
                      "unitCode":"DAY","name":"Location d'un climatiseur mobile, premier palier"},
                  "availability":"https://schema.org/InStock","url": url}},
      {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
        {"@type":"ListItem","position":1,"name":"Accueil","item": BASE + "/"},
        {"@type":"ListItem","position":2,"name": v['nom'],"item": url}]},
      {"@context":"https://schema.org","@type":"FAQPage",
       "mainEntity":[{"@type":"Question","name":q,
                      "acceptedAnswer":{"@type":"Answer","text":r}} for q, r in faq]},
    ]

    autres = ''.join(
        f'''<a href="/location-climatiseur-{a['slug']}">
          <b>{a['nom']}</b>
          <span>{a['resume']}</span>
        </a>''' for a in VILLES if a['slug'] != v['slug'])

    return f'''<!DOCTYPE html>
<!-- ══════════════════════════════════════════════════════════════════════════
     LOC'AIR — PAGE DE VILLE : {v['nom'].upper()}
     Une adresse par ville, parce que « location climatiseur Cannes » et
     « location climatiseur Menton » sont deux recherches différentes et que
     la page d'accueil ne peut pas répondre aux deux.
     Elle se lit sans JavaScript ; le seul script pose l'ombre de la barre.
══════════════════════════════════════════════════════════════════════════ -->
<html lang="fr" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{html.escape(v['titre_seo'])} — Loc'Air</title>
<link rel="canonical" href="{url}">
<meta name="description" content="{html.escape(v['desc'], quote=True)}">
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large">
<meta name="geo.placename" content="{html.escape(v['nom'], quote=True)}">
{partage(v['titre_seo'] + " — Loc'Air", v['desc'], url)}
{jsonld(ld)}
{tete_html()}
</head>
<body class="page">

<a class="sr-only" href="#texte">Aller au contenu</a>

{bar(v['nom'], None)}

<header class="tete">
  <div class="in">
    <p class="fil"><a href="/">Accueil</a><span>›</span>{v['nom']}</p>
    <span class="kicker">{v['region']}</span>
    <h1>{v['h1']}</h1>
    <p class="dire">{v['resume']}</p>
    <div class="tete-meta">
      <span><b>Dès 12 €</b> par jour</span>
      <span>Livraison <b>{LIVRAISON} €</b>, aller et retour</span>
      <span><b>Aucune caution</b></span>
      <span><b>4,9/5</b> sur 32 avis Google</span>
    </div>
    <div class="tete-act">
      <a class="btn btn-1" href="/">Voir les disponibilités →</a>
      <a class="btn btn-out" href="tel:+33663798756">06.63.79.87.56</a>
    </div>
  </div>
</header>

<main id="texte">

<!-- LE BANDEAU DE LA VILLE — vide aujourd'hui, et invisible tant qu'il
     l'est. Un visiteur de {v['nom']} doit reconnaître chez lui en une
     seconde ; aujourd'hui la page ne montre rien de sa ville. Le fichier
     n'a qu'à être déposé à la racine, sans toucher au code : c'est onload
     qui révèle la figure, et onload ne se déclenche jamais sur un fichier
     absent. Cadrage attendu : VISUELS.md, section 6. -->
<figure class="banniere photo photo-3-2" hidden>
  <img src="/ville-{v['slug']}-1600.jpg" width="1600" height="1067" loading="lazy" decoding="async"
       srcset="/ville-{v['slug']}-900.jpg 900w, /ville-{v['slug']}-1600.jpg 1600w"
       sizes="(max-width:1040px) 100vw, 1000px"
       alt="{v['nom']} en été — zone de livraison Loc'Air"
       onload="this.parentNode.hidden=false">
</figure>

<!-- Cinq lignes pour qui n'en lira pas plus. Un visiteur reste deux
     minutes : s'il repart après ce bandeau, il sait déjà le prix, ce qui
     est inclus, et ce qu'on ne lui demandera pas. -->
<section class="essentiel" aria-label="L'essentiel">
  <div class="essentiel-in">
    <div><b>{TOTAL_2SEM} €</b><span>Deux semaines à {v['nom']}, livraison et reprise comprises.</span></div>
    <div><b>0 €</b><span>De caution. Ni chèque, ni empreinte bancaire. Jamais.</span></div>
    <div><b>20 min</b><span>On monte l'appareil, on pose le kit sur la fenêtre, on vous montre.</span></div>
    <div><b>Le jour même</b><span>En cas de panne, on remplace l'appareil. Sans frais.</span></div>
    <div><b>Zéro trou</b><span>Le kit se retire sans percer et sans laisser de trace.</span></div>
  </div>
</section>

<!-- Le seul endroit de la page où quelqu'un parle à la première personne.
     L'avis cité est réel, déjà publié sur locair.fr, et son auteur est
     nommé — rien n'est écrit ici qui ne soit vérifiable. -->
<section class="mot">
  <div class="mot-in">
    <p>Chez Loc'Air, il n'y a pas de standard et pas de sous-traitant. Celui qui répond au téléphone est celui qui sonne à votre porte, monte l'appareil et pose le kit sur votre fenêtre. Depuis 2019, ça fait plus de 500 livraisons — et mon prénom dans les avis, ce qui veut dire que vous saurez à qui vous avez affaire.</p>
    <div class="mot-n"><b>Aly</b><span>Loc'Air · <a href="tel:+33663798756">06.63.79.87.56</a></span><span class="stars">★★★★★ 4,9/5</span></div>
    <p class="mot-q">«&nbsp;Parfait pour notre colocation&nbsp;! Aly a installé deux clims en moins d'une heure, tout compris dans le prix. On a passé l'été au frais sans se ruiner.&nbsp;»<br><b>Sophie Margot</b> · avis Google</p>
  </div>
</section>

<article class="art">
  <div class="mes">
    <p class="chapo">{v['chapo']}</p>
{som}{corps}
  </div>
</article>

<section class="appel">
  <div class="mes">
    <h2>Réserver pour {v['nom']}</h2>
    <p>Entrez votre adresse&nbsp;: le prix s'affiche avant que vous ne donniez quoi que ce soit d'autre. Aucune caution, kit posé, annulation gratuite jusqu'à la livraison.</p>
    <a class="btn btn-1" href="/">Voir les disponibilités →</a>
    <a class="btn btn-out" href="tel:+33663798756">06.63.79.87.56</a>
    <p class="mini">Une question sur votre fenêtre ou votre accès&nbsp;? Une photo sur <a href="https://wa.me/33663798756" target="_blank" rel="noopener">WhatsApp</a> suffit, nous répondons en quelques minutes.</p>
  </div>
</section>

<section class="suite">
  <div class="mes">
    <p>Nous livrons aussi</p>
    <div class="suite-l">{autres}<a href="/">
          <b>Nice</b>
          <span>Notre ville. Zone standard, livraison 60 €, livré 7j/7.</span>
        </a></div>
  </div>
</section>

</main>

{pied()}

{SCRIPT_BAR}
</body>
</html>
'''

if __name__ == '__main__':
    for v in VILLES:
        chemin = f"location-climatiseur-{v['slug']}.html"
        open(chemin, 'w', encoding='utf-8').write(typo_fr(page_ville(v)))
        print(chemin)
