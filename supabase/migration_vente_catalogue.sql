-- ════════════════════════════════════════════════════════════════════════
-- VENDRE DES CLIMATISEURS NEUFS — le catalogue devient vendable
--
-- Le catalogue des modèles existe déjà (modeles_climatiseur) : marque,
-- modèle, puissance, surface, bruit, classe énergie, photo, notice. Il sert
-- déjà la section « Mon climatiseur » de l'espace client. Il lui manque
-- exactement trois choses pour qu'on puisse vendre : un prix, un stock, et
-- un interrupteur.
--
-- On n'ajoute donc PAS de nouvelle table : on complète celle qui existe.
--
-- ⚠ CETTE MIGRATION N'EST PAS APPLIQUÉE.
-- Je n'ai aucun accès à la base de production. Tant que ce SQL n'est pas
-- collé dans Supabase → SQL Editor, ces colonnes n'existent pas.
-- Le code écrit en même temps que ce fichier en tient compte : il vérifie,
-- et s'il ne les trouve pas il se comporte exactement comme avant — la page
-- d'achat reste en « demander le prix », l'onglet Vente de l'admin affiche
-- « migration à appliquer ». Rien ne casse.
-- ════════════════════════════════════════════════════════════════════════

alter table modeles_climatiseur
  -- L'interrupteur. Un modèle peut très bien servir en location sans être
  -- à vendre : c'est le cas de tout le parc actuel.
  add column if not exists vente_active boolean not null default false,

  -- Le prix de vente TTC, en centimes — comme partout ailleurs dans la base
  -- (prix_total_cents, prix_vente_cents des offres privilège...). Jamais en
  -- euros flottants : 0,1 + 0,2 ne fait pas 0,3 en informatique.
  add column if not exists prix_vente_cents integer
    check (prix_vente_cents is null or prix_vente_cents > 0),

  -- Combien d'exemplaires NEUFS sont disponibles à la vente. Rien à voir
  -- avec le parc de location (table appareils) : ce sont des machines
  -- commandées pour être revendues, elles n'entrent jamais dans le calcul
  -- de disponibilité de la location.
  add column if not exists stock_vente integer not null default 0
    check (stock_vente >= 0),

  -- Le délai de livraison annoncé pour un achat. Différent de la location :
  -- la machine est commandée.
  add column if not exists delai_vente_jours integer
    check (delai_vente_jours is null or delai_vente_jours >= 0),

  -- La garantie du FABRICANT, en mois. Elle s'ajoute à la garantie légale
  -- de conformité de 2 ans, elle ne la remplace jamais.
  add column if not exists garantie_fabricant_mois integer
    check (garantie_fabricant_mois is null or garantie_fabricant_mois >= 0),

  -- L'installation à domicile : comprise dans le prix (0) ou facturée en
  -- plus (montant en centimes). NULL = non proposée.
  add column if not exists installation_vente_cents integer
    check (installation_vente_cents is null or installation_vente_cents >= 0);

-- Les modèles réellement en vente : ceux qui ont l'interrupteur, un prix et
-- du stock. C'est exactement ce que le site lit.
create index if not exists modeles_vente_idx
  on modeles_climatiseur (vente_active, stock_vente)
  where vente_active = true;

comment on column modeles_climatiseur.vente_active is
  'Ce modèle est proposé à la vente sur /acheter-climatiseur';
comment on column modeles_climatiseur.stock_vente is
  'Exemplaires NEUFS en stock pour la vente — sans rapport avec le parc de location';
