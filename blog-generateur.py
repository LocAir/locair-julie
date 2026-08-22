#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fabrique les pages du blog Loc'Air.

Un seul gabarit, six guides. Le contenu est ici, la mise en forme est dans
locair.css : les pages produites sont du HTML statique ordinaire, lisible et
modifiable à la main ensuite.

RÈGLE : aucun chiffre, aucun modèle, aucune date, aucun prix, aucun avis qui
ne soit pas déjà écrit sur le site. Chaque nombre de ce fichier est
vérifiable sur version-b.html ou pro.html.
"""
import re, json, html, os, math

BASE = "https://www.locair.fr"
DATE_ISO = "2026-08-22"
DATE_FR  = "22 août 2026"

# ══ LES MORCEAUX COMMUNS ═══════════════════════════════════════════════════

def bar():
    return '''<header class="bar" id="bar">
  <div class="bar-in">
    <a class="logo" href="/">Loc<i class="gt">'</i>Air</a>
    <a class="bar-fil" href="/blog">Guides</a>
    <a class="btn btn-1 btn-s" href="/">Réserver</a>
    <a class="bar-compte" href="/client" aria-label="Se connecter à mon espace">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M4.6 20.4a7.4 7.4 0 0 1 14.8 0"/></svg>
    </a>
  </div>
</header>'''

def pied():
    return '''<footer class="pied-bloc">
  <div class="in">
    <div class="pied-grid">
      <div>
        <h4>Nos guides</h4>
        <ul>
          <li><a href="/blog">Tous les guides</a></li>
          <li><a href="/blog/climatiseur-mobile-ou-rafraichisseur-air">Clim ou rafraîchisseur&nbsp;?</a></li>
          <li><a href="/blog/prix-location-climatiseur-mobile-nice">Le prix, en détail</a></li>
        </ul>
      </div>
      <div>
        <h4>Informations</h4>
        <ul>
          <li><a href="/cgv">Conditions générales</a></li>
          <li><a href="/mentions-legales">Mentions légales</a></li>
          <li><a href="/confidentialite">Confidentialité</a></li>
          <li><a href="https://www.medicys.fr" target="_blank" rel="noopener noreferrer">Médiation&nbsp;: MEDICYS</a></li>
        </ul>
      </div>
      <div>
        <h4>Nous joindre</h4>
        <ul>
          <li><a href="tel:+33663798756">06.63.79.87.56</a></li>
          <li><a href="https://wa.me/33663798756" target="_blank" rel="noopener">WhatsApp</a></li>
          <li><a href="mailto:contact@locair.fr">contact@locair.fr</a></li>
        </ul>
      </div>
      <div>
        <h4>Zones desservies</h4>
        <ul>
          <li>Nice Centre · Promenade des Anglais</li>
          <li>Vieux-Nice · Cimiez · Libération</li>
          <li>Magnan · Riquier · Caucade</li>
          <li>Saint-Isidore · Moulins</li>
        </ul>
      </div>
    </div>

    <div class="signature">
      <span class="logo signature-n">Loc<i class="gt">'</i>Air</span>
      <span class="signature-b">Le froid, à l'heure.</span>
    </div>
    <p class="pied">
      <span>THIAM ALY · SIRET 853 730 562 00024 · 11 Avenue Chantal, 06100 Nice · 7j/7 de 8h à 20h</span>
    </p>
  </div>
</footer>'''

SCRIPT_BAR = '''<script>
/* La barre prend son ombre dès qu'on a quitté le haut de la page. C'est le
   seul script de ces pages : un texte doit se lire sans JavaScript. */
(function(){
  var bar = document.getElementById('bar');
  if(!bar) return;
  var poser = function(){ bar.classList.toggle('pose', window.scrollY > 40); };
  poser();
  window.addEventListener('scroll', poser, {passive:true});
})();
</script>'''

def tete_html():
    return '''<link rel="icon" href="/favicon-b.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" media="print" onload="this.media='all';this.onload=null"
      href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&display=swap">
<noscript><link rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&display=swap"></noscript>
<link rel="stylesheet" href="/locair.css">'''

def partage(titre, desc, url):
    return f'''<meta property="og:type" content="article">
<meta property="og:site_name" content="Loc'Air">
<meta property="og:locale" content="fr_FR">
<meta property="og:title" content="{html.escape(titre, quote=True)}">
<meta property="og:description" content="{html.escape(desc, quote=True)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{BASE}/og-locair.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Loc'Air — le froid, à l'heure.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{html.escape(titre, quote=True)}">
<meta name="twitter:description" content="{html.escape(desc, quote=True)}">
<meta name="twitter:image" content="{BASE}/og-locair.png">'''

EDITEUR = {
    "@type": "Organization",
    "name": "Loc'Air",
    "url": BASE + "/",
    "logo": {"@type": "ImageObject", "url": BASE + "/og-locair.png"}
}

def jsonld(objets):
    return ('<script type="application/ld+json">\n'
            + json.dumps(objets, ensure_ascii=False, separators=(',', ':'))
            + '\n</script>')

def minutes(corps):
    """Temps de lecture réel : mots comptés, 200 mots la minute."""
    texte = re.sub(r'<[^>]+>', ' ', corps)
    mots = len([m for m in re.split(r'\s+', texte) if m.strip()])
    return max(2, round(mots / 200))

def sommaire(corps):
    """Le sommaire est construit à partir des vrais titres du texte : il ne
       peut donc jamais annoncer une section qui n'existe pas."""
    titres = re.findall(r'<h2 id="([^"]+)">(.*?)</h2>', corps, re.S)
    if not titres:
        return ''
    li = '\n'.join(f'      <li><a href="#{i}">{re.sub(r"<[^>]+>", "", t).strip()}</a></li>'
                   for i, t in titres)
    return ('    <nav class="som" aria-label="Sommaire">\n'
            '      <p>Dans ce guide</p>\n'
            '      <ol>\n' + li + '\n      </ol>\n'
            '    </nav>\n')

# ══ LE GABARIT D'UN GUIDE ══════════════════════════════════════════════════

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blog_contenu import ARTICLES

PAR_SLUG = {a['slug']: a for a in ARTICLES}

def bloc_faq(faq):
    """Les questions sont ÉCRITES SUR LA PAGE, pas seulement dans les données
       structurées : Google exige que ce qu'on lui déclare soit visible."""
    if not faq:
        return ''
    out = ['<h2 id="questions">Questions fréquentes</h2>']
    for q, r in faq:
        out.append(f'<h3>{q}</h3>\n<p>{r}</p>')
    return '\n'.join(out)

def page_article(a):
    url = f"{BASE}/blog/{a['slug']}"
    corps = a['corps'].strip() + '\n\n' + bloc_faq(a.get('faq'))
    mn = minutes(corps)
    som = sommaire(corps)

    ld = [
      {"@context":"https://schema.org","@type":"BlogPosting",
       "@id": url + "#article",
       "headline": a['titre_seo'],
       "description": a['desc'],
       "inLanguage": "fr-FR",
       "datePublished": DATE_ISO, "dateModified": DATE_ISO,
       "author": EDITEUR, "publisher": EDITEUR,
       "image": BASE + "/og-locair.png",
       "mainEntityOfPage": {"@type":"WebPage","@id": url},
       "isPartOf": {"@type":"Blog","@id": BASE + "/blog#blog","name":"Les guides Loc'Air"},
       "about": {"@type":"Service","name":"Location de climatiseurs mobiles et de rafraîchisseurs d'air adiabatiques",
                 "provider":{"@id": BASE + "/#business"},
                 "areaServed":{"@type":"City","name":"Nice"}}},
      {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
        {"@type":"ListItem","position":1,"name":"Accueil","item": BASE + "/"},
        {"@type":"ListItem","position":2,"name":"Guides","item": BASE + "/blog"},
        {"@type":"ListItem","position":3,"name": a['court'],"item": url}]}]
    if a.get('faq'):
        ld.append({"@context":"https://schema.org","@type":"FAQPage",
                   "mainEntity":[{"@type":"Question","name":q,
                                  "acceptedAnswer":{"@type":"Answer","text":r}}
                                 for q, r in a['faq']]})

    voisins = ''.join(
        f'''<a href="/blog/{PAR_SLUG[s]['slug']}">
          <b>{PAR_SLUG[s]['court']}</b>
          <span>{PAR_SLUG[s]['resume']}</span>
        </a>''' for s in a['suite'] if s in PAR_SLUG)

    if a.get('pro'):
        appel = '''    <h2>Un devis pour votre site&nbsp;?</h2>
    <p>Chaque local est différent&nbsp;: nous chiffrons après avoir vu le volume et les ouvertures. Livraison, installation et reprise comprises, aucune caution.</p>
    <a class="btn btn-1" href="/pro">Demander un devis →</a>
    <a class="btn btn-out" href="tel:+33663798756">06.63.79.87.56</a>
    <p class="mini">Loc'Air Pro · rafraîchisseurs d'air adiabatiques pour magasins, restaurants, entrepôts et événements.</p>'''
    else:
        appel = '''    <h2>L'air frais dès demain matin.</h2>
    <p>Livraison entre 8h et 12h, 7 jours sur 7. Aucune caution, kit de calfeutrage posé, annulation gratuite jusqu'à la livraison.</p>
    <a class="btn btn-1" href="/">Voir les disponibilités →</a>
    <a class="btn btn-out" href="tel:+33663798756">06.63.79.87.56</a>
    <p class="mini">Nice, Saint-Laurent-du-Var, Cagnes-sur-Mer et alentours · 4,9/5 sur Google.</p>'''

    return f'''<!DOCTYPE html>
<!-- ══════════════════════════════════════════════════════════════════════════
     LOC'AIR — GUIDE : {a['court'].upper()}
     Page fabriquée à partir d'un gabarit commun (voir l'historique du dépôt).
     Elle se lit sans JavaScript ; le seul script pose l'ombre de la barre.
══════════════════════════════════════════════════════════════════════════ -->
<html lang="fr" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{html.escape(a['titre_seo'])} — Loc'Air</title>
<link rel="canonical" href="{url}">
<meta name="description" content="{html.escape(a['desc'], quote=True)}">
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large">
<meta name="author" content="Loc'Air">
{partage(a['titre_seo'] + " — Loc'Air", a['desc'], url)}
{jsonld(ld)}
{tete_html()}
</head>
<body class="page">

<a class="sr-only" href="#texte">Aller au contenu</a>

{bar()}

<header class="tete">
  <div class="in">
    <p class="fil"><a href="/">Accueil</a><span>›</span><a href="/blog">Guides</a><span>›</span>{a['court']}</p>
    <span class="kicker">{a['rubrique']}</span>
    <h1>{a['h1']}</h1>
    <p class="dire">{a['resume']}</p>
    <div class="tete-meta">
      <span>Mis à jour le <b>{DATE_FR}</b></span>
      <span><b>{mn} min</b> de lecture</span>
      <span>Écrit par <b>Loc'Air</b>, à Nice</span>
    </div>
  </div>
</header>

<main id="texte">

<article class="art">
  <div class="mes">
    <p class="chapo">{a['chapo']}</p>
{som}{corps}
  </div>
</article>

<section class="appel">
  <div class="mes">
{appel}
  </div>
</section>

<section class="suite">
  <div class="mes">
    <p>À lire ensuite</p>
    <div class="suite-l">{voisins}</div>
  </div>
</section>

</main>

{pied()}

{SCRIPT_BAR}
</body>
</html>
'''

# ══ LE SOMMAIRE DU BLOG ════════════════════════════════════════════════════

def page_index():
    url = BASE + "/blog"
    lignes = []
    for a in ARTICLES:
        corps = a['corps'].strip() + '\n\n' + bloc_faq(a.get('faq'))
        lignes.append(f'''      <a class="guide" href="/blog/{a['slug']}">
        <span class="guide-k">{a['rubrique']}</span>
        <h2>{a['titre_seo']}</h2>
        <p>{a['desc']}</p>
        <span class="guide-t">{minutes(corps)} min</span>
      </a>''')

    ld = [
      {"@context":"https://schema.org","@type":"Blog","@id": url + "#blog",
       "name":"Les guides Loc'Air","url": url,"inLanguage":"fr-FR",
       "description":"Les guides de Loc'Air sur la location de climatiseurs mobiles et de rafraîchisseurs d'air à Nice : choisir sa machine, comprendre les prix, installer sans percer, tenir une canicule.",
       "publisher": EDITEUR,
       "blogPost":[{"@type":"BlogPosting","headline": a['titre_seo'],
                    "description": a['desc'], "datePublished": DATE_ISO,
                    "url": f"{BASE}/blog/{a['slug']}"} for a in ARTICLES]},
      {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
        {"@type":"ListItem","position":1,"name":"Accueil","item": BASE + "/"},
        {"@type":"ListItem","position":2,"name":"Guides","item": url}]}]

    titre = "Guides : louer un climatiseur mobile à Nice"
    desc = ("Les guides Loc'Air : choisir entre un climatiseur mobile et un rafraîchisseur d'air, "
            "comparer la location et l'achat, comprendre les prix, installer sans percer, tenir une canicule à Nice.")
    return f'''<!DOCTYPE html>
<!-- ══════════════════════════════════════════════════════════════════════════
     LOC'AIR — LES GUIDES
     Une liste, pas une grille de vignettes : le site n'a pas encore de
     photos, et une vignette sans photo est un rectangle gris. Chaque ligne
     porte sa rubrique, son titre, sa promesse et son temps de lecture — de
     quoi choisir sans avoir à cliquer.
══════════════════════════════════════════════════════════════════════════ -->
<html lang="fr" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{html.escape(titre)} — Loc'Air</title>
<link rel="canonical" href="{url}">
<meta name="description" content="{html.escape(desc, quote=True)}">
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large">
{partage(titre + " — Loc'Air", desc, url)}
{jsonld(ld)}
{tete_html()}
</head>
<body class="page">

<a class="sr-only" href="#texte">Aller au contenu</a>

{bar()}

<header class="tete">
  <div class="in">
    <p class="fil"><a href="/">Accueil</a><span>›</span>Guides</p>
    <span class="kicker">Les guides</span>
    <h1>Tout ce qu'on nous demande,<em> écrit une bonne fois.</em></h1>
    <p class="dire">Six guides, écrits par l'équipe qui livre. Aucun chiffre inventé&nbsp;: tout ce qui est écrit ici est le prix, la machine et la méthode de Loc'Air.</p>
  </div>
</header>

<main id="texte">
  <section class="guides">
    <div class="in">
{chr(10).join(lignes)}
    </div>
  </section>

  <section class="appel">
    <div class="mes">
      <h2>Une question qui n'est pas ici&nbsp;?</h2>
      <p>Envoyez-la sur WhatsApp, avec une photo de la pièce si c'est plus simple. Nous répondons en quelques minutes, 7j/7 de 8h à 20h.</p>
      <a class="btn btn-1" href="https://wa.me/33663798756" target="_blank" rel="noopener">Nous écrire sur WhatsApp →</a>
      <a class="btn btn-out" href="/">Voir les disponibilités</a>
    </div>
  </section>
</main>

{pied()}

{SCRIPT_BAR}
</body>
</html>
'''

# ══ ÉCRITURE ═══════════════════════════════════════════════════════════════

if __name__ == '__main__':
    cible = os.environ.get('CIBLE', 'blog')
    os.makedirs(cible, exist_ok=True)
    open(os.path.join(cible, 'index.html'), 'w', encoding='utf-8').write(page_index())
    print('blog/index.html')
    for a in ARTICLES:
        chemin = os.path.join(cible, a['slug'] + '.html')
        open(chemin, 'w', encoding='utf-8').write(page_article(a))
        print(chemin)
