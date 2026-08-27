#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AUDIT DU RÉFÉRENCEMENT LOCAL — LOC'AIR
────────────────────────────────────────────────────────────────────────────
Le pendant d'audit-i18n.py pour le référencement. Il ne devine rien : il lit
les fichiers du dépôt et vérifie ce qui est vérifiable sans sortir d'ici.

Ce qu'il contrôle, dans l'ordre d'importance pour un commerce local :

  1. NAP — nom, adresse, téléphone. C'est LE signal local. Google compare
     l'adresse déclarée sur le site avec celle de la fiche Google : si elles
     divergent, ou si le site n'en déclare aucune, tout le reste compte moins.
  2. La zone servie. « France » pour un commerce qui livre à Nice dilue le
     signal au lieu de l'affirmer.
  3. Une page par ville, avec la ville dans le titre.
  4. Le sitemap : chaque URL doit exister, chaque page indexable doit y être.
  5. robots.txt : ce qu'on bloque, on ne le référence pas — c'est parfois
     voulu, il faut juste le savoir.
  6. Titres et descriptions : présents, uniques, à la bonne longueur.
  7. Le maillage interne vers les pages villes.

Usage : python3 audit-seo.py
"""
import io, os, re, sys, json

RACINE = os.path.dirname(os.path.abspath(__file__))
SITE   = 'https://www.locair.fr'

def lire(p):
    try: return io.open(os.path.join(RACINE, p), encoding='utf-8').read()
    except Exception: return None

def pages_publiques():
    """Les pages que Google peut voir : ni brouillon, ni outil, ni aperçu."""
    out = []
    for f in sorted(os.listdir(RACINE)):
        if not f.endswith('.html'): continue
        if f.startswith('_') or f.startswith('apercu') or f.startswith('audit'): continue
        if 'suggestions' in f or f.startswith('google'): continue
        out.append(f)
    d = os.path.join(RACINE, 'blog')
    if os.path.isdir(d):
        out += ['blog/' + f for f in sorted(os.listdir(d)) if f.endswith('.html')]
    return out

def bloc(t, s):
    """Le contenu d'une balise simple."""
    m = re.search(r'<' + t + r'[^>]*>(.*?)</' + t + r'>', s, re.S | re.I)
    return re.sub(r'\s+', ' ', m.group(1)).strip() if m else None

def meta(nom, s):
    m = re.search(r'<meta\s+name=["\']' + nom + r'["\']\s+content=["\'](.*?)["\']', s, re.S | re.I)
    return re.sub(r'\s+', ' ', m.group(1)).strip() if m else None

def jsonld(s):
    """Tous les blocs de données structurées d'une page."""
    out = []
    for m in re.finditer(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', s, re.S):
        try: out.append(json.loads(m.group(1)))
        except Exception: pass
    return out

def trouver(o, cle):
    """Cherche une clé n'importe où dans une structure imbriquée."""
    if isinstance(o, dict):
        if cle in o: yield o[cle]
        for v in o.values():
            for r in trouver(v, cle): yield r
    elif isinstance(o, list):
        for v in o:
            for r in trouver(v, cle): yield r

soucis, notes = [], []
def pb(gravite, texte):  soucis.append((gravite, texte))
def ok(texte):           notes.append(texte)

pages = pages_publiques()
print('AUDIT DU RÉFÉRENCEMENT LOCAL — %d pages publiques\n' % len(pages))

# ══ 1 · NAP ══════════════════════════════════════════════════════════════
print('1 · NOM, ADRESSE, TÉLÉPHONE')
adresses, tels = {}, {}
for p in pages:
    s = lire(p)
    if not s: continue
    for d in jsonld(s):
        for a in trouver(d, 'address'):
            if not isinstance(a, dict): continue
            cle = (a.get('streetAddress', ''), a.get('postalCode', ''), a.get('addressLocality', ''))
            adresses.setdefault(cle, []).append(p)
        for t in trouver(d, 'telephone'):
            tels.setdefault(str(t), []).append(p)

for cle, ps in sorted(adresses.items(), key=lambda x: -len(x[1])):
    rue, cp, ville = cle
    lisible = ', '.join(x for x in (rue, cp, ville) if x) or '(VIDE)'
    marque = '   ' if rue and cp else ' ✗ '
    print('%s%-46s %d page(s) : %s' % (marque, lisible, len(ps), ', '.join(ps[:4])))
    if not (rue and cp):
        pb('CRITIQUE', 'Adresse incomplète dans les données structurées de : ' + ', '.join(ps))
if len(adresses) > 1:
    pb('IMPORTANT', '%d adresses différentes déclarées selon les pages — Google attend la même partout.' % len(adresses))
else:
    ok('Une seule adresse déclarée sur tout le site.')
if len(tels) > 1:
    pb('IMPORTANT', 'Plusieurs numéros déclarés : ' + ', '.join(tels))
elif tels:
    ok('Un seul numéro déclaré : ' + list(tels)[0])

# ══ 2 · ZONE SERVIE ══════════════════════════════════════════════════════
print('\n2 · ZONE SERVIE')
for p in pages:
    s = lire(p)
    if not s: continue
    for d in jsonld(s):
        for z in trouver(d, 'areaServed'):
            noms = [x.get('name') for x in z if isinstance(x, dict)] if isinstance(z, list) \
                   else ([z.get('name')] if isinstance(z, dict) else [str(z)])
            noms = [n for n in noms if n]
            large = [n for n in noms if n in ('France', 'Europe', 'Monde')]
            print('%s%-42s %s' % (' ✗ ' if large else '   ', p, ', '.join(noms)[:70]))
            if large:
                pb('IMPORTANT', '%s déclare servir « %s » : trop large pour un commerce local, '
                   'ça dilue le signal au lieu de l\'affirmer.' % (p, ', '.join(large)))

# ══ 3 · UNE PAGE PAR VILLE ═══════════════════════════════════════════════
print('\n3 · PAGES VILLES')
villes_page = sorted(p for p in pages if p.startswith('location-climatiseur-'))
for p in villes_page:
    v = p.replace('location-climatiseur-', '').replace('.html', '')
    t = bloc('title', lire(p)) or ''
    print('   %-42s %s' % (v, '✓ ville dans le titre' if v.lower() in t.lower() else '✗ VILLE ABSENTE DU TITRE'))
    if v.lower() not in t.lower():
        pb('IMPORTANT', 'La ville n\'apparaît pas dans le titre de ' + p)
# La ville du siège mérite sa page autant que les autres.
siege = None
for cle in adresses:
    if cle[2] and cle[0]: siege = cle[2]
if siege and not any(siege.lower() in p for p in villes_page):
    pb('CRITIQUE', 'Aucune page dédiée à %s — c\'est pourtant la ville du siège, '
       'donc la recherche locale la plus forte. Les autres villes en ont une.' % siege)
    print('   %-42s ✗ AUCUNE PAGE, alors que c\'est la ville du siège' % siege.lower())

# ══ 4 · SITEMAP ══════════════════════════════════════════════════════════
print('\n4 · SITEMAP')
sm = lire('sitemap.xml')
if not sm:
    pb('CRITIQUE', 'Aucun sitemap.xml.')
else:
    urls = re.findall(r'<loc>\s*([^<]+?)\s*</loc>', sm)
    print('   %d URL déclarées' % len(urls))
    manquantes = []
    for u in urls:
        chemin = u.replace(SITE, '').strip('/')
        if chemin == '': chemin = 'index'
        cands = [chemin + '.html', chemin + '/index.html', chemin]
        if not any(os.path.exists(os.path.join(RACINE, c)) for c in cands):
            manquantes.append(u)
    if manquantes:
        for u in manquantes: print('  ✗ pointe vers une page absente : ' + u)
        pb('CRITIQUE', '%d URL du sitemap n\'existent pas.' % len(manquantes))
    else:
        ok('Toutes les URL du sitemap existent.')
    # Une page indexable absente du sitemap ne sera trouvée que par hasard.
    rb = lire('robots.txt') or ''
    bloquees = set(re.findall(r'Disallow:\s*(\S+)', rb))
    oubliees = []
    for p in pages:
        s = lire(p) or ''
        if re.search(r'name=["\']robots["\'][^>]*noindex', s, re.I): continue
        if '/' + p in bloquees: continue
        slug = p.replace('.html', '').replace('index', '')
        if p == 'index.html': slug = ''
        if p.startswith('blog/'): slug = p.replace('.html', '').replace('/index', '')
        if not any(u.replace(SITE, '').strip('/') == slug.strip('/') for u in urls):
            oubliees.append(p)
    if oubliees:
        for p in oubliees: print('  ✗ indexable mais absente du sitemap : ' + p)
        pb('IMPORTANT', '%d page(s) indexables ne sont pas dans le sitemap.' % len(oubliees))

# ══ 5 · ROBOTS ═══════════════════════════════════════════════════════════
print('\n5 · ROBOTS.TXT')
rb = lire('robots.txt')
if rb:
    for d in re.findall(r'Disallow:\s*(\S+)', rb):
        f = d.strip('/')
        s = lire(f) or ''
        # Une page bloquée qui porte des données structurées commerciales est
        # sans doute bloquée par erreur.
        commercial = 'LocalBusiness' in s or 'Offer' in s
        print('   bloquée : %-38s %s' % (d, '← porte des données commerciales' if commercial else ''))
        if commercial and 'version-b' not in d and 'nouvelle-version' not in d:
            pb('À VÉRIFIER', '%s est bloquée aux moteurs alors qu\'elle porte une fiche '
               'commerciale. Volontaire ?' % d)

# ══ 6 · TITRES ET DESCRIPTIONS ═══════════════════════════════════════════
print('\n6 · TITRES ET DESCRIPTIONS')
vus_t, vus_d = {}, {}
for p in pages:
    s = lire(p)
    if not s: continue
    if re.search(r'name=["\']robots["\'][^>]*noindex', s, re.I): continue
    t, d = bloc('title', s), meta('description', s)
    if not t: pb('IMPORTANT', 'Pas de titre : ' + p); continue
    if not d: pb('IMPORTANT', 'Pas de description : ' + p); continue
    vus_t.setdefault(t, []).append(p); vus_d.setdefault(d, []).append(p)
    if len(t) > 60:  print('   %-42s titre %d car. (au-delà de 60, Google coupe)' % (p, len(t)))
    if len(d) > 160: print('   %-42s desc. %d car. (au-delà de 160, Google coupe)' % (p, len(d)))
for t, ps in vus_t.items():
    if len(ps) > 1: pb('IMPORTANT', 'Titre identique sur : ' + ', '.join(ps))
for d, ps in vus_d.items():
    if len(ps) > 1: pb('IMPORTANT', 'Description identique sur : ' + ', '.join(ps))
trop_longs = sum(1 for t in vus_t if len(t) > 60)
print('   %d titres uniques, %d descriptions uniques, %d titres trop longs'
      % (len(vus_t), len(vus_d), trop_longs))

# ══ 7 · MAILLAGE VERS LES VILLES ═════════════════════════════════════════
print('\n7 · LIENS INTERNES VERS LES PAGES VILLES')
for v in villes_page:
    slug = v.replace('.html', '')
    n = sum(1 for p in pages if p != v and ('/' + slug) in (lire(p) or ''))
    print('   %-42s %d page(s) y mènent' % (slug, n))
    if n == 0:
        pb('IMPORTANT', 'Aucune page ne mène à %s : une page orpheline se référence mal.' % slug)

# ══ VERDICT ══════════════════════════════════════════════════════════════
print('\n' + '─' * 74)
if not soucis:
    print('AUCUN DÉFAUT MESURABLE.')
else:
    for g in ('CRITIQUE', 'IMPORTANT', 'À VÉRIFIER'):
        l = [t for gr, t in soucis if gr == g]
        if l:
            print('\n%s (%d)' % (g, len(l)))
            for t in l: print('  · ' + t)
for n in notes: print('\n✓ ' + n)
sys.exit(1 if any(g == 'CRITIQUE' for g, _ in soucis) else 0)
