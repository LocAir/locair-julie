"""
Google Ads API client for Loc'Air.
All monetary values in micros (1€ = 1_000_000 micros).
"""

import os
import logging
from typing import Any
from google.ads.googleads.client import GoogleAdsClient as _GoogleAdsClient
from google.ads.googleads.errors import GoogleAdsException

logger = logging.getLogger(__name__)

_MICROS = 1_000_000


def _micros_to_euros(micros: int) -> float:
    return round(micros / _MICROS, 2)


def _euros_to_micros(euros: float) -> int:
    return int(euros * _MICROS)


class GoogleAdsClient:
    """Wrapper around the Google Ads API for campaign management."""

    def __init__(self):
        yaml_path = os.getenv("GOOGLE_ADS_YAML_PATH", "google-ads.yaml")
        if os.path.exists(yaml_path):
            self.client = _GoogleAdsClient.load_from_storage(yaml_path)
        else:
            self.client = _GoogleAdsClient.load_from_env()
        self.customer_id = os.environ["GOOGLE_ADS_CUSTOMER_ID"].replace("-", "")

    # ─────────────────────────── REPORTING ──────────────────────────────────

    def get_account_overview(self, date_range: str = "LAST_30_DAYS") -> dict:
        """Account-level performance summary."""
        query = f"""
            SELECT
                metrics.clicks,
                metrics.impressions,
                metrics.ctr,
                metrics.average_cpc,
                metrics.cost_micros,
                metrics.conversions,
                metrics.cost_per_conversion
            FROM customer
            WHERE segments.date DURING {date_range}
        """
        rows = self._run_query(query)
        if not rows:
            return {"error": "Aucune donnée disponible"}
        m = rows[0].metrics
        return {
            "date_range": date_range,
            "clicks": m.clicks,
            "impressions": m.impressions,
            "ctr": round(m.ctr * 100, 2),
            "cpc_moyen_euros": _micros_to_euros(int(m.average_cpc)),
            "depense_euros": _micros_to_euros(int(m.cost_micros)),
            "conversions": round(m.conversions, 1),
            "cout_par_conversion_euros": _micros_to_euros(int(m.cost_per_conversion)),
        }

    def list_campaigns(self, date_range: str = "LAST_30_DAYS") -> list[dict]:
        """List all campaigns with performance metrics."""
        query = f"""
            SELECT
                campaign.id,
                campaign.name,
                campaign.status,
                campaign.bidding_strategy_type,
                campaign_budget.amount_micros,
                metrics.clicks,
                metrics.impressions,
                metrics.ctr,
                metrics.average_cpc,
                metrics.cost_micros,
                metrics.conversions,
                metrics.cost_per_conversion
            FROM campaign
            WHERE segments.date DURING {date_range}
            ORDER BY metrics.cost_micros DESC
        """
        rows = self._run_query(query)
        campaigns = []
        for row in rows:
            c = row.campaign
            b = row.campaign_budget
            m = row.metrics
            campaigns.append({
                "id": str(c.id),
                "nom": c.name,
                "statut": c.status.name,
                "strategie_enchere": c.bidding_strategy_type.name,
                "budget_quotidien_euros": _micros_to_euros(int(b.amount_micros)),
                "clics": m.clicks,
                "impressions": m.impressions,
                "ctr": round(m.ctr * 100, 2),
                "cpc_moyen_euros": _micros_to_euros(int(m.average_cpc)),
                "depense_euros": _micros_to_euros(int(m.cost_micros)),
                "conversions": round(m.conversions, 1),
                "cout_par_conversion_euros": _micros_to_euros(int(m.cost_per_conversion)),
            })
        return campaigns

    def list_ad_groups(self, campaign_id: str, date_range: str = "LAST_30_DAYS") -> list[dict]:
        """List ad groups for a campaign with performance."""
        query = f"""
            SELECT
                ad_group.id,
                ad_group.name,
                ad_group.status,
                ad_group.cpc_bid_micros,
                metrics.clicks,
                metrics.impressions,
                metrics.ctr,
                metrics.average_cpc,
                metrics.cost_micros,
                metrics.conversions
            FROM ad_group
            WHERE campaign.id = {campaign_id}
              AND segments.date DURING {date_range}
            ORDER BY metrics.cost_micros DESC
        """
        rows = self._run_query(query)
        groups = []
        for row in rows:
            ag = row.ad_group
            m = row.metrics
            groups.append({
                "id": str(ag.id),
                "nom": ag.name,
                "statut": ag.status.name,
                "cpc_max_euros": _micros_to_euros(int(ag.cpc_bid_micros)),
                "clics": m.clicks,
                "impressions": m.impressions,
                "ctr": round(m.ctr * 100, 2),
                "cpc_moyen_euros": _micros_to_euros(int(m.average_cpc)),
                "depense_euros": _micros_to_euros(int(m.cost_micros)),
                "conversions": round(m.conversions, 1),
            })
        return groups

    def list_keywords(self, campaign_id: str, date_range: str = "LAST_30_DAYS") -> list[dict]:
        """List keywords with performance and quality score."""
        query = f"""
            SELECT
                ad_group_criterion.criterion_id,
                ad_group_criterion.keyword.text,
                ad_group_criterion.keyword.match_type,
                ad_group_criterion.status,
                ad_group_criterion.cpc_bid_micros,
                ad_group_criterion.quality_info.quality_score,
                ad_group.name,
                metrics.clicks,
                metrics.impressions,
                metrics.ctr,
                metrics.average_cpc,
                metrics.cost_micros,
                metrics.conversions
            FROM keyword_view
            WHERE campaign.id = {campaign_id}
              AND segments.date DURING {date_range}
            ORDER BY metrics.clicks DESC
        """
        rows = self._run_query(query)
        keywords = []
        for row in rows:
            kw = row.ad_group_criterion
            m = row.metrics
            keywords.append({
                "id": str(kw.criterion_id),
                "mot_cle": kw.keyword.text,
                "type_correspondance": kw.keyword.match_type.name,
                "statut": kw.status.name,
                "groupe_annonces": row.ad_group.name,
                "cpc_max_euros": _micros_to_euros(int(kw.cpc_bid_micros)),
                "score_qualite": kw.quality_info.quality_score,
                "clics": m.clicks,
                "impressions": m.impressions,
                "ctr": round(m.ctr * 100, 2),
                "cpc_moyen_euros": _micros_to_euros(int(m.average_cpc)),
                "depense_euros": _micros_to_euros(int(m.cost_micros)),
                "conversions": round(m.conversions, 1),
            })
        return keywords

    def get_search_terms(self, campaign_id: str, date_range: str = "LAST_30_DAYS", limit: int = 50) -> list[dict]:
        """Get search terms report to find new keyword opportunities and negatives."""
        query = f"""
            SELECT
                search_term_view.search_term,
                search_term_view.status,
                metrics.clicks,
                metrics.impressions,
                metrics.ctr,
                metrics.average_cpc,
                metrics.cost_micros,
                metrics.conversions
            FROM search_term_view
            WHERE campaign.id = {campaign_id}
              AND segments.date DURING {date_range}
              AND metrics.impressions > 0
            ORDER BY metrics.clicks DESC
            LIMIT {limit}
        """
        rows = self._run_query(query)
        terms = []
        for row in rows:
            st = row.search_term_view
            m = row.metrics
            terms.append({
                "terme": st.search_term,
                "statut": st.status.name,
                "clics": m.clicks,
                "impressions": m.impressions,
                "ctr": round(m.ctr * 100, 2),
                "cpc_moyen_euros": _micros_to_euros(int(m.average_cpc)),
                "depense_euros": _micros_to_euros(int(m.cost_micros)),
                "conversions": round(m.conversions, 1),
            })
        return terms

    def list_ads(self, ad_group_id: str, date_range: str = "LAST_30_DAYS") -> list[dict]:
        """List responsive search ads for an ad group."""
        query = f"""
            SELECT
                ad_group_ad.ad.id,
                ad_group_ad.ad.responsive_search_ad.headlines,
                ad_group_ad.ad.responsive_search_ad.descriptions,
                ad_group_ad.ad.final_urls,
                ad_group_ad.status,
                metrics.clicks,
                metrics.impressions,
                metrics.ctr,
                metrics.average_cpc,
                metrics.cost_micros,
                metrics.conversions
            FROM ad_group_ad
            WHERE ad_group.id = {ad_group_id}
              AND ad_group_ad.ad.type = RESPONSIVE_SEARCH_AD
              AND segments.date DURING {date_range}
        """
        rows = self._run_query(query)
        ads = []
        for row in rows:
            ad = row.ad_group_ad.ad
            rsa = ad.responsive_search_ad
            m = row.metrics
            ads.append({
                "id": str(ad.id),
                "statut": row.ad_group_ad.status.name,
                "titres": [h.text for h in rsa.headlines],
                "descriptions": [d.text for d in rsa.descriptions],
                "url_finale": list(ad.final_urls)[0] if ad.final_urls else "",
                "clics": m.clicks,
                "impressions": m.impressions,
                "ctr": round(m.ctr * 100, 2),
                "cpc_moyen_euros": _micros_to_euros(int(m.average_cpc)),
                "depense_euros": _micros_to_euros(int(m.cost_micros)),
                "conversions": round(m.conversions, 1),
            })
        return ads

    # ─────────────────────────── CAMPAIGN ACTIONS ───────────────────────────

    def update_campaign_budget(self, campaign_id: str, new_budget_euros: float) -> dict:
        """Update the daily budget for a campaign."""
        # First get the budget resource name
        query = f"""
            SELECT campaign_budget.resource_name, campaign_budget.amount_micros
            FROM campaign
            WHERE campaign.id = {campaign_id}
            LIMIT 1
        """
        rows = self._run_query(query)
        if not rows:
            return {"succes": False, "erreur": f"Campagne {campaign_id} introuvable"}

        budget_rn = rows[0].campaign_budget.resource_name
        old_budget = _micros_to_euros(int(rows[0].campaign_budget.amount_micros))

        budget_service = self.client.get_service("CampaignBudgetService")
        budget_op = self.client.get_type("CampaignBudgetOperation")
        budget = budget_op.update
        budget.resource_name = budget_rn
        budget.amount_micros = _euros_to_micros(new_budget_euros)

        field_mask = self.client.get_type("FieldMask")
        field_mask.paths.append("amount_micros")
        budget_op.update_mask.CopyFrom(field_mask)

        try:
            budget_service.mutate_campaign_budgets(
                customer_id=self.customer_id,
                operations=[budget_op]
            )
            return {
                "succes": True,
                "campaign_id": campaign_id,
                "ancien_budget_euros": old_budget,
                "nouveau_budget_euros": new_budget_euros,
            }
        except GoogleAdsException as e:
            return {"succes": False, "erreur": str(e)}

    def set_campaign_status(self, campaign_id: str, status: str) -> dict:
        """Enable or pause a campaign. status: 'ENABLED' or 'PAUSED'."""
        campaign_service = self.client.get_service("CampaignService")
        campaign_op = self.client.get_type("CampaignOperation")
        campaign = campaign_op.update
        campaign.resource_name = campaign_service.campaign_path(self.customer_id, campaign_id)

        status_enum = self.client.enums.CampaignStatusEnum.CampaignStatus
        campaign.status = status_enum[status]

        field_mask = self.client.get_type("FieldMask")
        field_mask.paths.append("status")
        campaign_op.update_mask.CopyFrom(field_mask)

        try:
            campaign_service.mutate_campaigns(
                customer_id=self.customer_id,
                operations=[campaign_op]
            )
            return {"succes": True, "campaign_id": campaign_id, "nouveau_statut": status}
        except GoogleAdsException as e:
            return {"succes": False, "erreur": str(e)}

    # ─────────────────────────── AD GROUP ACTIONS ───────────────────────────

    def update_ad_group_bid(self, ad_group_id: str, new_cpc_max_euros: float) -> dict:
        """Update the max CPC bid for an ad group."""
        ag_service = self.client.get_service("AdGroupService")
        ag_op = self.client.get_type("AdGroupOperation")
        ag = ag_op.update
        ag.resource_name = ag_service.ad_group_path(self.customer_id, ad_group_id)
        ag.cpc_bid_micros = _euros_to_micros(new_cpc_max_euros)

        field_mask = self.client.get_type("FieldMask")
        field_mask.paths.append("cpc_bid_micros")
        ag_op.update_mask.CopyFrom(field_mask)

        try:
            ag_service.mutate_ad_groups(
                customer_id=self.customer_id,
                operations=[ag_op]
            )
            return {
                "succes": True,
                "ad_group_id": ad_group_id,
                "nouveau_cpc_max_euros": new_cpc_max_euros,
            }
        except GoogleAdsException as e:
            return {"succes": False, "erreur": str(e)}

    # ─────────────────────────── KEYWORD ACTIONS ────────────────────────────

    def add_keywords(self, ad_group_id: str, keywords: list[dict]) -> dict:
        """
        Add keywords to an ad group.
        keywords: list of {"text": str, "match_type": "BROAD"|"PHRASE"|"EXACT", "cpc_max_euros": float}
        """
        ag_service = self.client.get_service("AdGroupService")
        criterion_service = self.client.get_service("AdGroupCriterionService")
        match_type_enum = self.client.enums.KeywordMatchTypeEnum.KeywordMatchType

        operations = []
        for kw in keywords:
            op = self.client.get_type("AdGroupCriterionOperation")
            criterion = op.create
            criterion.ad_group = ag_service.ad_group_path(self.customer_id, ad_group_id)
            criterion.status = self.client.enums.AdGroupCriterionStatusEnum.AdGroupCriterionStatus.ENABLED
            criterion.keyword.text = kw["text"]
            criterion.keyword.match_type = match_type_enum[kw.get("match_type", "BROAD")]
            if kw.get("cpc_max_euros"):
                criterion.cpc_bid_micros = _euros_to_micros(kw["cpc_max_euros"])
            operations.append(op)

        try:
            response = criterion_service.mutate_ad_group_criteria(
                customer_id=self.customer_id,
                operations=operations
            )
            return {
                "succes": True,
                "ad_group_id": ad_group_id,
                "mots_cles_ajoutes": len(operations),
                "resultats": [str(r.resource_name) for r in response.results],
            }
        except GoogleAdsException as e:
            return {"succes": False, "erreur": str(e)}

    def set_keyword_status(self, ad_group_id: str, criterion_id: str, status: str) -> dict:
        """Enable or pause a keyword. status: 'ENABLED' or 'PAUSED'."""
        criterion_service = self.client.get_service("AdGroupCriterionService")
        op = self.client.get_type("AdGroupCriterionOperation")
        criterion = op.update
        criterion.resource_name = criterion_service.ad_group_criterion_path(
            self.customer_id, ad_group_id, criterion_id
        )
        status_enum = self.client.enums.AdGroupCriterionStatusEnum.AdGroupCriterionStatus
        criterion.status = status_enum[status]

        field_mask = self.client.get_type("FieldMask")
        field_mask.paths.append("status")
        op.update_mask.CopyFrom(field_mask)

        try:
            criterion_service.mutate_ad_group_criteria(
                customer_id=self.customer_id,
                operations=[op]
            )
            return {
                "succes": True,
                "criterion_id": criterion_id,
                "nouveau_statut": status,
            }
        except GoogleAdsException as e:
            return {"succes": False, "erreur": str(e)}

    def add_negative_keywords(self, campaign_id: str, keywords: list[dict]) -> dict:
        """
        Add campaign-level negative keywords.
        keywords: list of {"text": str, "match_type": "BROAD"|"PHRASE"|"EXACT"}
        """
        criterion_service = self.client.get_service("CampaignCriterionService")
        campaign_service = self.client.get_service("CampaignService")
        match_type_enum = self.client.enums.KeywordMatchTypeEnum.KeywordMatchType

        operations = []
        for kw in keywords:
            op = self.client.get_type("CampaignCriterionOperation")
            criterion = op.create
            criterion.campaign = campaign_service.campaign_path(self.customer_id, campaign_id)
            criterion.negative = True
            criterion.keyword.text = kw["text"]
            criterion.keyword.match_type = match_type_enum[kw.get("match_type", "BROAD")]
            operations.append(op)

        try:
            response = criterion_service.mutate_campaign_criteria(
                customer_id=self.customer_id,
                operations=operations
            )
            return {
                "succes": True,
                "campaign_id": campaign_id,
                "negatifs_ajoutes": len(operations),
            }
        except GoogleAdsException as e:
            return {"succes": False, "erreur": str(e)}

    def update_keyword_bid(self, ad_group_id: str, criterion_id: str, new_cpc_max_euros: float) -> dict:
        """Update the max CPC bid for a specific keyword."""
        criterion_service = self.client.get_service("AdGroupCriterionService")
        op = self.client.get_type("AdGroupCriterionOperation")
        criterion = op.update
        criterion.resource_name = criterion_service.ad_group_criterion_path(
            self.customer_id, ad_group_id, criterion_id
        )
        criterion.cpc_bid_micros = _euros_to_micros(new_cpc_max_euros)

        field_mask = self.client.get_type("FieldMask")
        field_mask.paths.append("cpc_bid_micros")
        op.update_mask.CopyFrom(field_mask)

        try:
            criterion_service.mutate_ad_group_criteria(
                customer_id=self.customer_id,
                operations=[op]
            )
            return {
                "succes": True,
                "criterion_id": criterion_id,
                "nouveau_cpc_max_euros": new_cpc_max_euros,
            }
        except GoogleAdsException as e:
            return {"succes": False, "erreur": str(e)}

    # ─────────────────────────── AD CREATION ────────────────────────────────

    def create_responsive_search_ad(
        self,
        ad_group_id: str,
        headlines: list[str],
        descriptions: list[str],
        final_url: str,
    ) -> dict:
        """
        Create a responsive search ad (RSA).
        Requires 3-15 headlines and 2-4 descriptions.
        """
        if len(headlines) < 3 or len(descriptions) < 2:
            return {"succes": False, "erreur": "Minimum 3 titres et 2 descriptions requis"}

        ag_service = self.client.get_service("AdGroupService")
        ad_service = self.client.get_service("AdGroupAdService")
        ad_type = self.client.get_type

        op = ad_type("AdGroupAdOperation")
        ad_group_ad = op.create
        ad_group_ad.ad_group = ag_service.ad_group_path(self.customer_id, ad_group_id)
        ad_group_ad.status = self.client.enums.AdGroupAdStatusEnum.AdGroupAdStatus.ENABLED

        rsa = ad_group_ad.ad.responsive_search_ad
        for h in headlines[:15]:
            asset = ad_type("AdTextAsset")
            asset.text = h
            rsa.headlines.append(asset)
        for d in descriptions[:4]:
            asset = ad_type("AdTextAsset")
            asset.text = d
            rsa.descriptions.append(asset)

        ad_group_ad.ad.final_urls.append(final_url)

        try:
            response = ad_service.mutate_ad_group_ads(
                customer_id=self.customer_id,
                operations=[op]
            )
            return {
                "succes": True,
                "ad_group_id": ad_group_id,
                "annonce_creee": str(response.results[0].resource_name),
                "nb_titres": len(headlines),
                "nb_descriptions": len(descriptions),
            }
        except GoogleAdsException as e:
            return {"succes": False, "erreur": str(e)}

    # ─────────────────────────── INTERNAL ───────────────────────────────────

    def _run_query(self, query: str) -> list[Any]:
        """Run a GAQL query and return rows."""
        service = self.client.get_service("GoogleAdsService")
        try:
            response = service.search(customer_id=self.customer_id, query=query)
            return list(response)
        except GoogleAdsException as e:
            logger.error("Google Ads API error: %s", e)
            raise
