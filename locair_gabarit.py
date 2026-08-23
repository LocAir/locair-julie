#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Les morceaux communs à toutes les pages de texte de Loc'Air.

Les guides (/blog) et les pages de ville (/location-climatiseur-…) partagent
la même barre, le même pied de page, les mêmes balises de partage, la même
façon de compter un temps de lecture et de construire un sommaire.
Une seule source : sans ça, la barre aurait fini par exister en trois
versions qui se seraient séparées au premier changement.
"""
import re, json, html, os, math

BASE = "https://www.locair.fr"
DATE_ISO = "2026-08-22"
DATE_FR  = "22 août 2026"

# ══ LES MORCEAUX COMMUNS ═══════════════════════════════════════════════════

def bar(fil="Guides", href="/blog"):
    """Le libellé à côté du nom dit OÙ l'on est : « Guides » sur un guide, le
       nom de la ville sur une page de ville. Sans href, c'est un simple
       repère et non un lien — inutile de mener à la page où l'on se trouve
       déjà."""
    repere = (f'<a class="bar-fil" href="{href}">{fil}</a>' if href
              else f'<span class="bar-fil">{fil}</span>') if fil else ''
    return f'''<header class="bar" id="bar">
  <div class="bar-in">
    <a class="logo" href="/">Loc<i class="gt">'</i>Air</a>
    {repere}
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

def sommaire(corps, titre="Dans ce guide"):
    """Le sommaire est construit à partir des vrais titres du texte : il ne
       peut donc jamais annoncer une section qui n'existe pas."""
    titres = re.findall(r'<h2 id="([^"]+)">(.*?)</h2>', corps, re.S)
    if not titres:
        return ''
    li = '\n'.join(f'      <li><a href="#{i}">{re.sub(r"<[^>]+>", "", t).strip()}</a></li>'
                   for i, t in titres)
    return ('    <nav class="som" aria-label="Sommaire">\n'
            f'      <p>{titre}</p>\n'
            '      <ol>\n' + li + '\n      </ol>\n'
            '    </nav>\n')


# ══ TYPOGRAPHIE FRANÇAISE ══════════════════════════════════════════════════
#    En français, l'espace qui précède : ; ? ! » doit être INSÉCABLE. Sans
#    elle, la ponctuation tombe seule en début de ligne — c'est exactement ce
#    qu'on voyait sur l'écran « Sous le capot », où une ligne commençait par
#    « : ».
#    La correction est appliquée à la page ENTIÈRE au moment de l'écriture,
#    et non au contenu à la source : personne n'a plus à y penser en
#    écrivant un guide ou une page de ville.
#    On insère le caractère réel U+00A0, jamais &nbsp; : l'audit i18n
#    interdit les entités, et le caractère se compare à l'identique.

def typo_fr(page):
    """Insère l'espace insécable dans les nœuds de texte d'une page HTML.
       Ne touche ni aux scripts, ni aux styles, ni aux commentaires, ni aux
       attributs — donc ni aux URL, ni aux données structurées JSON."""
    zones = [(m.start(), m.end()) for m in
             re.finditer(r'<(script|style)\b.*?</\1>|<!--.*?-->', page, re.S)]
    def protege(i):
        return any(a <= i < b for a, b in zones)
    remplacements = []
    for m in re.finditer(r'>([^<>]+)<', page):
        if protege(m.start()):
            continue
        avant = m.group(1)
        apres = re.sub(r'(?<=[^\s\u00a0\u202f])[ \t]+([:;?!»])', '\u00a0\\1', avant)
        apres = re.sub(r'(«)[ \t]+', '\\1\u00a0', apres)
        # la flèche d'un bouton appartient au dernier mot : seule en début de
        # ligne, elle ressemble à une coquille
        apres = re.sub(r'(?<=[^\s\u00a0\u202f])[ \t]+([→←])', '\u00a0\\1', apres)
        # le symbole ne se sépare jamais de son nombre : « 500 à 900 » avec
        # « € » seul à la ligne suivante se lit comme une coquille
        apres = re.sub(r'(\d)[ \t]+(€|%)', '\\1\u00a0\\2', apres)
        if avant != apres:
            remplacements.append((m.start(1), m.end(1), apres))
    for d, f, txt in reversed(remplacements):
        page = page[:d] + txt + page[f:]
    return page
