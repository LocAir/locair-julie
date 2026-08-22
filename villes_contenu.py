# -*- coding: utf-8 -*-
"""Le contenu des pages de ville.

RÈGLE, la même que pour les guides : aucun prix, aucune durée, aucun modèle
et aucun avis qui ne soit pas déjà écrit sur le site. Les seuls éléments
propres à ces pages sont des noms de quartiers — de la géographie, pas des
promesses.

CE QUI N'EST VOLONTAIREMENT PAS ÉCRIT ICI :
  · l'option Express (livré sous 2h) — elle est crédible à Nice, pas à
    trente minutes de route ;
  · l'engagement « si nous sonnons après midi, la livraison est offerte » —
    il est pris pour la zone niçoise, et l'étendre sans l'accord d'Aly
    reviendrait à promettre à sa place.
Ces deux réserves sont le vrai sujet à trancher avec lui.
"""

# Le prix de la livraison hors zone n'est pas décidé ici : api/checkout.js
# facture 120 € dès que le code postal n'est pas dans cities.postal_codes,
# et 60 € s'il y est. Les quatre villes ci-dessous sont hors zone sur le
# site (écran « Où nous opérons »), donc 120 €.
LIVRAISON = 120
DEUX_SEMAINES = 154          # 7 jours à 12 € + 7 jours à 10 €
TOTAL_2SEM = DEUX_SEMAINES + LIVRAISON   # 274 €

VILLES = []

VILLES.append(dict(
slug="cannes",
nom="Cannes",
region="Alpes-Maritimes",
cp="06400 · 06150",
titre_seo="Location de climatiseur mobile à Cannes",
h1="Location de climatiseur mobile à Cannes.<em> Livré, posé, repris.</em>",
desc="Location de climatiseur mobile et de rafraîchisseur d'air à Cannes : livré, installé et repris. Dès 12 € par jour, 120 € de livraison, aucune caution.",
resume="Vous ouvrez la porte, on s'occupe du reste. Sans caution.",
chapo="Une chambre du Suquet qui ne redescend pas de la nuit, un appartement loué pour la saison où l'on n'a pas le droit de percer un mur, une terrasse en plein soleil pendant un tournage — voilà pourquoi on nous appelle à Cannes.",
quartiers=["La Croisette","Le Suquet","La Bocca","Palm Beach","Croix-des-Gardes",
           "Petit Juas","République","Basse Californie","Port Canto"],
contexte="""<p>Cannes vit l'été à guichets fermés : congrès, tournages, locations saisonnières, appartements anciens aux beaux volumes et sans climatisation. Trois situations reviennent chez nous&nbsp;:</p>
<ul>
  <li><b>Un appartement loué pour la saison</b>, où l'on n'a pas le droit de percer un mur. Le kit de calfeutrage se pose et se retire sans laisser de trace.</li>
  <li><b>Une chambre sous les toits</b> qui ne redescend pas la nuit, dans le Suquet ou le Petit Juas.</li>
  <li><b>Un événement</b> — chapiteau, terrasse, tournage. Là, ce n'est pas un climatiseur qu'il faut&nbsp;: c'est un rafraîchisseur d'air.</li>
</ul>""",
))

VILLES.append(dict(
slug="antibes",
nom="Antibes",
region="Alpes-Maritimes",
cp="06600 · 06160",
titre_seo="Location de climatiseur mobile à Antibes",
h1="Location de climatiseur mobile à Antibes.<em> Livré, posé, repris.</em>",
desc="Location de climatiseur mobile et de rafraîchisseur d'air à Antibes et Juan-les-Pins : livré, installé et repris. Dès 12 € par jour, 120 € de livraison, aucune caution.",
resume="Antibes et Juan-les-Pins. Vous ouvrez la porte, on s'occupe du reste.",
chapo="La chambre des enfants invivable à partir de 15h, la location saisonnière qu'il faut équiper sans rien fixer au mur, la terrasse du port où l'air ne tient pas — voilà pourquoi on nous appelle à Antibes et à Juan-les-Pins.",
quartiers=["Vieil Antibes","Juan-les-Pins","Cap d'Antibes","La Fontonne","Les Semboules",
           "Port Vauban","La Salis","Les Combes","La Brague"],
contexte="""<p>Antibes se loue et se prête beaucoup l'été, et la demande qui nous arrive vient de trois endroits&nbsp;:</p>
<ul>
  <li><b>Les locations saisonnières et les conciergeries.</b> Vous n'avez pas besoin d'être propriétaire pour louer chez nous, et rien n'est fixé dans le mur.</li>
  <li><b>Les maisons et villas</b> où une pièce — la chambre des enfants, le bureau — reste invivable l'après-midi. Un appareil dans cette pièce-là, porte fermée, suffit.</li>
  <li><b>Le port et les terrasses</b>, où l'air se renouvelle en permanence. Un climatiseur n'y peut rien&nbsp;; un rafraîchisseur, si.</li>
</ul>""",
))

VILLES.append(dict(
slug="monaco",
nom="Monaco",
region="Principauté de Monaco",
cp="98000",
titre_seo="Location de climatiseur mobile à Monaco",
h1="Location de climatiseur mobile à Monaco.<em> Livré, posé, repris.</em>",
desc="Location de climatiseur mobile et de rafraîchisseur d'air à Monaco : livré, installé et repris. Dès 12 € par jour, 120 € de livraison, aucune caution.",
resume="Monte-Carlo, La Condamine, Fontvieille. On monte, on pose, on repart.",
chapo="Un appartement en étage dont la façade prend le soleil tout l'après-midi, une chambre d'amis à rendre vivable avant l'arrivée, un commerce dont la porte reste ouverte — voilà pourquoi on nous appelle à Monaco.",
quartiers=["Monte-Carlo","La Condamine","Fontvieille","Monaco-Ville","Larvotto",
           "Moneghetti","Jardin Exotique","Saint-Roman"],
contexte="""<p>À Monaco, presque tout se passe en immeuble. Deux choses changent par rapport à une maison, et il vaut mieux les régler avant la livraison qu'après&nbsp;:</p>
<ul>
  <li><b>L'accès.</b> Dites-nous l'étage, s'il y a un ascenseur, et où le camion peut s'arrêter. Nous préparons la tournée avec ça.</li>
  <li><b>La fenêtre.</b> Coulissante, oscillo-battante, baie vitrée&nbsp;: envoyez-nous une photo sur WhatsApp, nous répondons en quelques minutes et le technicien part avec le matériel adapté.</li>
</ul>
<p>Pour un commerce, un restaurant ou une terrasse — là où la porte reste ouverte —, c'est un rafraîchisseur d'air qu'il faut, pas un climatiseur.</p>""",
))

VILLES.append(dict(
slug="menton",
nom="Menton",
region="Alpes-Maritimes",
cp="06500",
titre_seo="Location de climatiseur mobile à Menton",
h1="Location de climatiseur mobile à Menton.<em> Livré, posé, repris.</em>",
desc="Location de climatiseur mobile et de rafraîchisseur d'air à Menton : livré, installé et repris. Dès 12 € par jour, 120 € de livraison, aucune caution.",
resume="Garavan, la vieille ville, le Borrigo. On monte, on pose, on repart.",
chapo="À Menton, l'air ne circule pas : il stagne, et l'humidité avec. C'est le cas où le déshumidificateur intégré à l'appareil compte autant que le froid — à température égale, un air sec se supporte bien mieux qu'un air moite.",
quartiers=["Garavan","Vieille Ville","Le Borrigo","Le Careï","Val de Menton",
           "Baie de Garavan","Les Cyprès","Saint-Roman"],
contexte="""<p>Menton est protégée du vent, et c'est justement ce qui la rend lourde l'été : l'air stagne, et l'humidité avec. C'est le cas où le déshumidificateur intégré au climatiseur compte autant que le froid — à température égale, un air sec se supporte bien mieux qu'un air moite.</p>
<ul>
  <li><b>Les appartements de la vieille ville</b>, aux murs épais et aux fenêtres étroites, qui gardent la chaleur de la journée jusque tard.</li>
  <li><b>Les maisons de Garavan et du Borrigo</b>, où une seule pièce pose problème.</li>
  <li><b>Les terrasses et les jardins</b>, où le climatiseur ne sert à rien et le rafraîchisseur oui.</li>
</ul>""",
))
