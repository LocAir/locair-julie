#!/usr/bin/env python3
"""Mesure la couverture de traduction de version-b.html.

Compte tout ce qu'un visiteur peut lire — texte visible, textes d'exemple des
champs, libellés d'accessibilité — et regarde si chacun porte un marqueur de
traduction (data-t / data-th / data-tp / data-ta).

Sert de juge de paix pour la boucle : tant que le pourcentage n'est pas à
100 %, il reste du travail.
"""
import re, sys
from html.parser import HTMLParser

IGNORE_BALISES = {'script', 'style'}
# Textes qui ne se traduisent pas : numéros, symboles, noms propres, montants.
NON_TRADUISIBLE = re.compile(
    r'^[\s\d\W_]*$'                       # que des chiffres/ponctuation
    # noms propres, marques, personnes
    r'|^(Loc|Air|Nice|Aly|AT|WhatsApp|Stripe|MEDICYS|SIRET|Rowenta|Frico|Hisense'
    r'|Yassine|Lauriane|Mike|Fabio|Daniel Lopez Francia|locair\.fr|THIAM ALY)$'
    # noms de langues : dans un sélecteur, chaque langue s'écrit dans SA langue.
    # Traduire "English" en français serait une faute d'usage, pas une omission.
    r'|^(🇫🇷\s*)?Français$|^(🇬🇧\s*)?English$|^(🇨🇳\s*)?中文$|^(🇷🇺\s*)?Русский$'
    r'|^(FR|EN|ZH|RU)$'
    # chemins d'URL et adresses e-mail affichés tels quels
    r'|^/[a-z0-9-]+$'
    r'|^[\w.+-]+@[\w.-]+$'
    # Communes et quartiers : ce sont des ADRESSES. Un visiteur russe ou
    # chinois doit lire "Saint-Laurent-du-Var" pour retrouver le lieu sur une
    # carte ou le dicter à un chauffeur. Les traduire le desservirait.
    r'|^(Saint-Laurent-du-Var|Cagnes-sur-Mer|Villefranche-sur-Mer|Beaulieu-sur-Mer)$'
    r'|^Cannes · Antibes · Menton$'
    r'|^Nice Centre · Promenade des Anglais$|^Vieux-Nice · Cimiez · Libération$'
    r'|^Magnan · Riquier · Caucade$|^Saint-Isidore · Moulins$',
    re.I)

class Audit(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.pile = []
        self.marque = []          # marqueur de traduction de l'élément courant
        self.couverts, self.manquants = [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self.pile.append(tag)
        marque = any(k in a for k in ('data-t', 'data-th'))
        self.marque.append(marque)
        for attr, cle in (('placeholder', 'data-tp'), ('aria-label', 'data-ta')):
            if a.get(attr) and not NON_TRADUISIBLE.match(a[attr].strip()):
                (self.couverts if cle in a else self.manquants).append(
                    f'[{attr}] {a[attr][:60]}')
        if tag in ('img',) and a.get('alt') and not NON_TRADUISIBLE.match(a['alt']):
            (self.couverts if 'data-talt' in a else self.manquants).append(
                f'[alt] {a["alt"][:60]}')

    def handle_endtag(self, tag):
        if self.pile and self.pile[-1] == tag:
            self.pile.pop(); self.marque.pop()

    def handle_data(self, texte):
        t = texte.strip()
        if not t or NON_TRADUISIBLE.match(t):
            return
        if any(b in IGNORE_BALISES for b in self.pile):
            return
        # un marqueur sur un ancêtre couvre le texte qu'il contient
        (self.couverts if any(self.marque) else self.manquants).append(t[:70])

def verifier_entites(src):
    """Une valeur du dictionnaire ne doit pas contenir d'entité HTML.

    data-t écrit du texte brut : "&nbsp;" s'afficherait tel quel à l'écran.
    Ce contrôle existe parce que le cas s'est produit — le titre "Vous êtes une
    conciergerie&nbsp;?" s'affichait avec le code visible.
    """
    if 'var T = {}' not in src:
        return []
    bloc = src[src.index('var T = {}'):src.index('window.setLangue')]
    fautifs = []
    for m in re.finditer(r"'([\w.]+)'\s*:\s*\{(.*?)\}", bloc, re.S):
        ents = set(re.findall(r'&(?:nbsp|amp|lt|gt|#\d+);', m.group(2)))
        if ents:
            fautifs.append((m.group(1), sorted(ents)))
    return fautifs

src = open(sys.argv[1] if len(sys.argv) > 1 else 'version-b.html', encoding='utf-8').read()
corps = src[src.index('<body'):] if '<body' in src else src
corps = re.sub(r'<!--.*?-->', '', corps, flags=re.S)      # commentaires exclus

a = Audit(); a.feed(corps)
total = len(a.couverts) + len(a.manquants)
pct = (len(a.couverts) / total * 100) if total else 100
print(f'Textes traduisibles : {total}')
print(f'  couverts   : {len(a.couverts)}')
print(f'  manquants  : {len(a.manquants)}')
print(f'  COUVERTURE : {pct:.1f} %')
fautifs = verifier_entites(src)
if fautifs:
    print(f'\n⚠ {len(fautifs)} traduction(s) contiennent du code HTML au lieu du caractère :')
    for cle, ents in fautifs:
        print('  ✗', cle, ' '.join(ents))
else:
    print('  entités HTML : aucune ✓')

if '-v' in sys.argv:
    print('\n── Restants ──')
    for m in a.manquants:
        print('  ·', m)
