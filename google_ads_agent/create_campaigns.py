"""
Crée les 3 campagnes initiales Google Ads pour Loc'Air.
Les campagnes sont créées en statut PAUSED pour révision avant activation.

Usage :
    python create_campaigns.py
    python create_campaigns.py --enable   # active immédiatement
"""

import os
import sys
import logging
from dotenv import load_dotenv
from google.ads.googleads.client import GoogleAdsClient
from google.ads.googleads.errors import GoogleAdsException

load_dotenv()
logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")

MICROS = 1_000_000
FINAL_URL = os.getenv("LOCAIR_WEBSITE_URL", "https://www.locair.fr/")

# ─── Données campagnes ────────────────────────────────────────────────────────

CAMPAIGNS = [
    {
        "name": "Loc'Air — Location Directe",
        "budget_euros": 15.0,
        "ad_groups": [
            {
                "name": "Location Climatiseur Nice",
                "cpc_max_euros": 1.20,
                "keywords": [
                    ("location climatiseur Nice", "EXACT"),
                    ("louer climatiseur Nice", "EXACT"),
                    ("location clim mobile Nice", "PHRASE"),
                    ("climatiseur mobile à louer Nice", "PHRASE"),
                    ("location climatisation Nice", "PHRASE"),
                    ("louer clim 06", "BROAD"),
                    ("location climatiseur Cannes", "EXACT"),
                    ("location climatiseur Antibes", "EXACT"),
                    ("location climatiseur Monaco", "EXACT"),
                    ("location climatiseur Côte d'Azur", "PHRASE"),
                    ("location clim courte durée Nice", "PHRASE"),
                    ("climatiseur mobile location Nice", "PHRASE"),
                    ("louer climatiseur Menton", "EXACT"),
                    ("louer climatiseur Grasse", "EXACT"),
                ],
                "headlines": [
                    "Location Climatiseur Nice",
                    "Livraison Dès Demain",
                    "Dès 19€/Jour",
                    "Sans Engagement",
                    "Clim Mobile Livrée",
                    "3 Jours à 1 Mois",
                    "Nice · Cannes · Antibes",
                    "Réservez en Ligne",
                    "Climatiseur Mobile à Louer",
                    "06.63.79.87.56",
                ],
                "descriptions": [
                    "Climatiseur mobile livré et installé chez vous à Nice. À partir de 19€/jour.",
                    "Location de 3 jours à 1 mois. Sans engagement. Livraison rapide sur la Côte d'Azur.",
                    "Particuliers et professionnels. Réservez en ligne en 2 minutes. Livraison incluse.",
                ],
            }
        ],
        "negative_keywords": [],
    },
    {
        "name": "Loc'Air — Achat Intercepté",
        "budget_euros": 10.0,
        "ad_groups": [
            {
                "name": "Achat Climatiseur",
                "cpc_max_euros": 0.90,
                "keywords": [
                    ("acheter climatiseur Nice", "PHRASE"),
                    ("climatiseur portable pas cher Nice", "PHRASE"),
                    ("climatiseur sans gaines Nice", "PHRASE"),
                    ("acheter clim mobile", "BROAD"),
                    ("prix climatiseur portable", "PHRASE"),
                    ("climatiseur réversible mobile", "PHRASE"),
                    ("clim mobile pas cher", "BROAD"),
                    ("meilleur climatiseur mobile", "BROAD"),
                ],
                "headlines": [
                    "Louez Plutôt Qu'Acheter",
                    "Location Clim Dès 19€/Jour",
                    "Pas Besoin d'Acheter",
                    "Livré Chez Vous Demain",
                    "Zéro Investissement",
                    "Pas de Stockage en Hiver",
                    "Économisez Sur la Clim",
                    "Climatiseur Mobile Nice",
                    "Réservez en 2 Minutes",
                ],
                "descriptions": [
                    "Louez plutôt qu'acheter : climatiseur livré chez vous dès 19€/jour à Nice.",
                    "Pas de stockage, pas d'entretien. Location de 3 jours à 1 mois. Livraison incluse.",
                    "Économisez vs l'achat. Climatiseur livré et installé sur Nice et alentours.",
                ],
            },
            {
                "name": "Achat Ventilateur / Rafraîchisseur",
                "cpc_max_euros": 0.70,
                "keywords": [
                    ("acheter ventilateur Nice", "PHRASE"),
                    ("ventilateur puissant Nice", "PHRASE"),
                    ("rafraîchisseur d'air Nice", "PHRASE"),
                    ("ventilateur climatiseur Nice", "PHRASE"),
                    ("achat ventilateur climatiseur", "BROAD"),
                    ("climatiseur mobile sans installation", "PHRASE"),
                ],
                "headlines": [
                    "Mieux Qu'un Ventilateur",
                    "Climatiseur Mobile à Louer",
                    "Louez Dès 19€/Jour à Nice",
                    "Livré Chez Vous Demain",
                    "Fraîcheur Garantie",
                    "Pas Besoin d'Acheter",
                    "Solution Anti-Chaleur Nice",
                ],
                "descriptions": [
                    "Un climatiseur loué est plus efficace qu'un ventilateur. Livré à Nice dès 19€/jour.",
                    "Oubliez le ventilateur : louez un vrai climatiseur mobile. Sans engagement. Livraison incluse.",
                ],
            },
        ],
        "negative_keywords": [
            ("location", "BROAD"),
            ("réparer", "BROAD"),
            ("panne", "BROAD"),
            ("entretien", "BROAD"),
            ("recharge gaz", "PHRASE"),
            ("installation fixe", "PHRASE"),
        ],
    },
    {
        "name": "Loc'Air — Urgence Chaleur",
        "budget_euros": 5.0,
        "ad_groups": [
            {
                "name": "Chaleur Urgence Nice",
                "cpc_max_euros": 0.80,
                "keywords": [
                    ("canicule Nice solution", "BROAD"),
                    ("appartement trop chaud Nice", "PHRASE"),
                    ("se rafraîchir Nice", "BROAD"),
                    ("solution chaleur appartement Nice", "PHRASE"),
                    ("climatisation appartement sans travaux", "PHRASE"),
                    ("trop chaud appartement Nice", "PHRASE"),
                    ("vague de chaleur Nice que faire", "BROAD"),
                ],
                "headlines": [
                    "Trop Chaud à Nice ?",
                    "Solution Anti-Chaleur Rapide",
                    "Climatiseur Livré Demain",
                    "Dès 19€/Jour",
                    "Fraîcheur Immédiate",
                    "Appartement Surchauffé ?",
                    "Location Clim Mobile Nice",
                    "Disponible Maintenant",
                ],
                "descriptions": [
                    "Canicule à Nice ? Louez un climatiseur mobile livré chez vous dès demain à partir de 19€.",
                    "Votre appartement est trop chaud ? Climatiseur mobile livré et installé à Nice.",
                    "Solution rapide contre la chaleur. Livraison le jour même sur Nice et alentours.",
                ],
            }
        ],
        "negative_keywords": [],
    },
]

GEO_TARGETS = ["Nice", "Cannes", "Antibes", "Monaco", "Menton", "Grasse"]

# ─── Helpers ──────────────────────────────────────────────────────────────────


def get_client():
    yaml_path = os.getenv("GOOGLE_ADS_YAML_PATH", "google-ads.yaml")
    if os.path.exists(yaml_path):
        return GoogleAdsClient.load_from_storage(yaml_path)
    return GoogleAdsClient.load_from_env()


def get_customer_id():
    return os.environ["GOOGLE_ADS_CUSTOMER_ID"].replace("-", "")


def lookup_geo_targets(client, customer_id, city_names):
    """Return a dict {city_name: resource_name} for each found city."""
    svc = client.get_service("GeoTargetConstantService")
    req = client.get_type("SuggestGeoTargetConstantsRequest")
    req.locale = "fr"
    req.country_code = "FR"
    req.location_names.names.extend(city_names)
    resp = svc.suggest_geo_target_constants(request=req)
    result = {}
    for suggestion in resp.geo_target_constant_suggestions:
        geo = suggestion.geo_target_constant
        for name in city_names:
            if geo.name.lower() == name.lower() and name not in result:
                result[name] = geo.resource_name
    return result


def create_budget(client, customer_id, name, daily_euros):
    svc = client.get_service("CampaignBudgetService")
    op = client.get_type("CampaignBudgetOperation")
    b = op.create
    b.name = f"{name} — Budget"
    b.amount_micros = int(daily_euros * MICROS)
    b.delivery_method = client.enums.BudgetDeliveryMethodEnum.BudgetDeliveryMethod.STANDARD
    resp = svc.mutate_campaign_budgets(customer_id=customer_id, operations=[op])
    return resp.results[0].resource_name


def create_campaign(client, customer_id, name, budget_rn, geo_rns, status):
    svc = client.get_service("CampaignService")
    op = client.get_type("CampaignOperation")
    c = op.create
    c.name = name
    c.status = client.enums.CampaignStatusEnum.CampaignStatus[status]
    c.advertising_channel_type = (
        client.enums.AdvertisingChannelTypeEnum.AdvertisingChannelType.SEARCH
    )
    c.campaign_budget = budget_rn
    c.manual_cpc.enhanced_cpc_enabled = True
    c.network_settings.target_google_search = True
    c.network_settings.target_search_network = True
    c.network_settings.target_content_network = False

    resp = svc.mutate_campaigns(customer_id=customer_id, operations=[op])
    campaign_rn = resp.results[0].resource_name

    if geo_rns:
        crit_svc = client.get_service("CampaignCriterionService")
        geo_ops = []
        for geo_rn in geo_rns:
            geo_op = client.get_type("CampaignCriterionOperation")
            geo_op.create.campaign = campaign_rn
            geo_op.create.location.geo_target_constant = geo_rn
            geo_ops.append(geo_op)
        crit_svc.mutate_campaign_criteria(customer_id=customer_id, operations=geo_ops)

    return campaign_rn


def add_negative_keywords_to_campaign(client, customer_id, campaign_rn, neg_kws):
    if not neg_kws:
        return
    svc = client.get_service("CampaignCriterionService")
    mt = client.enums.KeywordMatchTypeEnum.KeywordMatchType
    ops = []
    for text, match in neg_kws:
        op = client.get_type("CampaignCriterionOperation")
        op.create.campaign = campaign_rn
        op.create.negative = True
        op.create.keyword.text = text
        op.create.keyword.match_type = mt[match]
        ops.append(op)
    svc.mutate_campaign_criteria(customer_id=customer_id, operations=ops)


def create_ad_group(client, customer_id, campaign_rn, name, cpc_euros):
    svc = client.get_service("AdGroupService")
    op = client.get_type("AdGroupOperation")
    ag = op.create
    ag.name = name
    ag.campaign = campaign_rn
    ag.status = client.enums.AdGroupStatusEnum.AdGroupStatus.ENABLED
    ag.type_ = client.enums.AdGroupTypeEnum.AdGroupType.SEARCH_STANDARD
    ag.cpc_bid_micros = int(cpc_euros * MICROS)
    resp = svc.mutate_ad_groups(customer_id=customer_id, operations=[op])
    return resp.results[0].resource_name


def add_keywords_to_group(client, customer_id, ad_group_rn, keywords):
    svc = client.get_service("AdGroupCriterionService")
    mt = client.enums.KeywordMatchTypeEnum.KeywordMatchType
    ops = []
    for text, match in keywords:
        op = client.get_type("AdGroupCriterionOperation")
        c = op.create
        c.ad_group = ad_group_rn
        c.status = client.enums.AdGroupCriterionStatusEnum.AdGroupCriterionStatus.ENABLED
        c.keyword.text = text
        c.keyword.match_type = mt[match]
        ops.append(op)
    svc.mutate_ad_group_criteria(customer_id=customer_id, operations=ops)


def create_rsa(client, customer_id, ad_group_rn, headlines, descriptions):
    svc = client.get_service("AdGroupAdService")
    op = client.get_type("AdGroupAdOperation")
    aa = op.create
    aa.ad_group = ad_group_rn
    aa.status = client.enums.AdGroupAdStatusEnum.AdGroupAdStatus.ENABLED

    rsa = aa.ad.responsive_search_ad
    for h in headlines:
        asset = client.get_type("AdTextAsset")
        asset.text = h
        rsa.headlines.append(asset)
    for d in descriptions:
        asset = client.get_type("AdTextAsset")
        asset.text = d
        rsa.descriptions.append(asset)
    aa.ad.final_urls.append(FINAL_URL)

    svc.mutate_ad_group_ads(customer_id=customer_id, operations=[op])


# ─── Main ─────────────────────────────────────────────────────────────────────


def main():
    enable = "--enable" in sys.argv
    status = "ENABLED" if enable else "PAUSED"

    print("=" * 60)
    print("  Création des campagnes Google Ads — Loc'Air")
    print(f"  Statut initial : {status}")
    print("=" * 60)
    print()

    try:
        client = get_client()
        customer_id = get_customer_id()
    except Exception as e:
        print(f"Erreur de connexion : {e}")
        print("Vérifiez votre fichier .env ou google-ads.yaml")
        sys.exit(1)

    # Geo targeting
    print("Recherche des zones géographiques...")
    try:
        geo_map = lookup_geo_targets(client, customer_id, GEO_TARGETS)
        found = list(geo_map.keys())
        print(f"  Zones trouvées : {', '.join(found) if found else 'aucune (ciblage national par défaut)'}")
    except Exception as e:
        print(f"  Avertissement : impossible de résoudre les zones ({e}). Ciblage sans restriction géo.")
        geo_map = {}

    geo_rns = list(geo_map.values())

    for camp_data in CAMPAIGNS:
        print()
        print(f"Création : {camp_data['name']}")
        try:
            budget_rn = create_budget(client, customer_id, camp_data["name"], camp_data["budget_euros"])
            print(f"  ✓ Budget : {camp_data['budget_euros']}€/jour")

            campaign_rn = create_campaign(client, customer_id, camp_data["name"], budget_rn, geo_rns, status)
            print(f"  ✓ Campagne créée ({status})")

            if camp_data["negative_keywords"]:
                add_negative_keywords_to_campaign(client, customer_id, campaign_rn, camp_data["negative_keywords"])
                print(f"  ✓ {len(camp_data['negative_keywords'])} mots-clés négatifs ajoutés")

            for ag_data in camp_data["ad_groups"]:
                ag_rn = create_ad_group(
                    client, customer_id, campaign_rn, ag_data["name"], ag_data["cpc_max_euros"]
                )
                print(f"  ✓ Groupe : {ag_data['name']} (CPC max {ag_data['cpc_max_euros']}€)")

                add_keywords_to_group(client, customer_id, ag_rn, ag_data["keywords"])
                print(f"    ✓ {len(ag_data['keywords'])} mots-clés ajoutés")

                create_rsa(client, customer_id, ag_rn, ag_data["headlines"], ag_data["descriptions"])
                print(f"    ✓ Annonce RSA créée ({len(ag_data['headlines'])} titres, {len(ag_data['descriptions'])} descriptions)")

        except GoogleAdsException as e:
            print(f"  ✗ Erreur Google Ads : {e}")
            for error in e.failure.errors:
                print(f"    — {error.message}")
        except Exception as e:
            print(f"  ✗ Erreur inattendue : {e}")

    print()
    print("=" * 60)
    if enable:
        print("  Campagnes créées et ACTIVÉES.")
        print("  Surveillez les dépenses dans Google Ads les premières heures.")
    else:
        print("  Campagnes créées en mode PAUSED.")
        print("  Vérifiez-les dans Google Ads, puis activez-les quand vous êtes prêt.")
        print("  Pour activer maintenant : python create_campaigns.py --enable")
    print("=" * 60)


if __name__ == "__main__":
    main()
