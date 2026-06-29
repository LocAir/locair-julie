"""
Google Ads AI Agent — Loc'Air
Usage:
    python agent.py "Analyse mes campagnes des 7 derniers jours"
    python agent.py  (mode interactif)
"""

import json
import logging
import os
import sys
from dotenv import load_dotenv
import anthropic

from google_ads_client import GoogleAdsClient
from prompts import SYSTEM_PROMPT

load_dotenv()

logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

MODEL = "claude-opus-4-8"
MAX_TOKENS = 8096
MAX_TURNS = 20  # safety limit per session

# ──────────────────────────── TOOL DEFINITIONS ──────────────────────────────

TOOLS: list[dict] = [
    {
        "name": "get_account_overview",
        "description": "Obtenir un résumé des performances globales du compte Google Ads sur une période.",
        "input_schema": {
            "type": "object",
            "properties": {
                "date_range": {
                    "type": "string",
                    "description": "Période d'analyse",
                    "enum": ["LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_MONTH", "THIS_MONTH", "THIS_YEAR"],
                }
            },
            "required": ["date_range"],
        },
    },
    {
        "name": "list_campaigns",
        "description": "Lister toutes les campagnes avec leurs métriques de performance (clics, dépense, conversions, etc.).",
        "input_schema": {
            "type": "object",
            "properties": {
                "date_range": {
                    "type": "string",
                    "enum": ["LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_MONTH", "THIS_MONTH", "THIS_YEAR"],
                }
            },
            "required": ["date_range"],
        },
    },
    {
        "name": "list_ad_groups",
        "description": "Lister les groupes d'annonces d'une campagne avec leurs performances.",
        "input_schema": {
            "type": "object",
            "properties": {
                "campaign_id": {"type": "string", "description": "ID de la campagne"},
                "date_range": {
                    "type": "string",
                    "enum": ["LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_MONTH", "THIS_MONTH", "THIS_YEAR"],
                },
            },
            "required": ["campaign_id", "date_range"],
        },
    },
    {
        "name": "list_keywords",
        "description": "Lister les mots-clés d'une campagne avec performances et score de qualité.",
        "input_schema": {
            "type": "object",
            "properties": {
                "campaign_id": {"type": "string", "description": "ID de la campagne"},
                "date_range": {
                    "type": "string",
                    "enum": ["LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_MONTH", "THIS_MONTH", "THIS_YEAR"],
                },
            },
            "required": ["campaign_id", "date_range"],
        },
    },
    {
        "name": "get_search_terms",
        "description": "Obtenir le rapport des termes de recherche pour identifier de nouveaux mots-clés et les négatifs à ajouter.",
        "input_schema": {
            "type": "object",
            "properties": {
                "campaign_id": {"type": "string"},
                "date_range": {
                    "type": "string",
                    "enum": ["LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_MONTH", "THIS_MONTH", "THIS_YEAR"],
                },
                "limit": {"type": "integer", "description": "Nombre max de termes à retourner (défaut: 50)", "default": 50},
            },
            "required": ["campaign_id", "date_range"],
        },
    },
    {
        "name": "list_ads",
        "description": "Lister les annonces responsive search ads d'un groupe d'annonces.",
        "input_schema": {
            "type": "object",
            "properties": {
                "ad_group_id": {"type": "string"},
                "date_range": {
                    "type": "string",
                    "enum": ["LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_MONTH", "THIS_MONTH", "THIS_YEAR"],
                },
            },
            "required": ["ad_group_id", "date_range"],
        },
    },
    {
        "name": "update_campaign_budget",
        "description": "Modifier le budget quotidien d'une campagne.",
        "input_schema": {
            "type": "object",
            "properties": {
                "campaign_id": {"type": "string"},
                "new_budget_euros": {"type": "number", "description": "Nouveau budget quotidien en euros"},
            },
            "required": ["campaign_id", "new_budget_euros"],
        },
    },
    {
        "name": "set_campaign_status",
        "description": "Activer (ENABLED) ou mettre en pause (PAUSED) une campagne.",
        "input_schema": {
            "type": "object",
            "properties": {
                "campaign_id": {"type": "string"},
                "status": {"type": "string", "enum": ["ENABLED", "PAUSED"]},
            },
            "required": ["campaign_id", "status"],
        },
    },
    {
        "name": "update_ad_group_bid",
        "description": "Modifier l'enchère CPC max d'un groupe d'annonces.",
        "input_schema": {
            "type": "object",
            "properties": {
                "ad_group_id": {"type": "string"},
                "new_cpc_max_euros": {"type": "number", "description": "Nouveau CPC max en euros"},
            },
            "required": ["ad_group_id", "new_cpc_max_euros"],
        },
    },
    {
        "name": "add_keywords",
        "description": "Ajouter de nouveaux mots-clés à un groupe d'annonces.",
        "input_schema": {
            "type": "object",
            "properties": {
                "ad_group_id": {"type": "string"},
                "keywords": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "text": {"type": "string"},
                            "match_type": {"type": "string", "enum": ["BROAD", "PHRASE", "EXACT"]},
                            "cpc_max_euros": {"type": "number"},
                        },
                        "required": ["text", "match_type"],
                    },
                },
            },
            "required": ["ad_group_id", "keywords"],
        },
    },
    {
        "name": "set_keyword_status",
        "description": "Activer ou mettre en pause un mot-clé spécifique.",
        "input_schema": {
            "type": "object",
            "properties": {
                "ad_group_id": {"type": "string"},
                "criterion_id": {"type": "string"},
                "status": {"type": "string", "enum": ["ENABLED", "PAUSED"]},
            },
            "required": ["ad_group_id", "criterion_id", "status"],
        },
    },
    {
        "name": "update_keyword_bid",
        "description": "Modifier l'enchère CPC max d'un mot-clé spécifique.",
        "input_schema": {
            "type": "object",
            "properties": {
                "ad_group_id": {"type": "string"},
                "criterion_id": {"type": "string"},
                "new_cpc_max_euros": {"type": "number"},
            },
            "required": ["ad_group_id", "criterion_id", "new_cpc_max_euros"],
        },
    },
    {
        "name": "add_negative_keywords",
        "description": "Ajouter des mots-clés négatifs au niveau de la campagne pour exclure du trafic non pertinent.",
        "input_schema": {
            "type": "object",
            "properties": {
                "campaign_id": {"type": "string"},
                "keywords": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "text": {"type": "string"},
                            "match_type": {"type": "string", "enum": ["BROAD", "PHRASE", "EXACT"]},
                        },
                        "required": ["text", "match_type"],
                    },
                },
            },
            "required": ["campaign_id", "keywords"],
        },
    },
    {
        "name": "create_campaign",
        "description": (
            "Créer une nouvelle campagne Search Google Ads avec un budget quotidien et un ciblage géographique. "
            "Retourne un campaign_id à utiliser ensuite avec create_ad_group. "
            "Crée toujours en statut PAUSED par défaut pour validation avant activation."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Nom de la campagne"},
                "daily_budget_euros": {"type": "number", "description": "Budget quotidien en euros"},
                "cities": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Villes françaises à cibler (ex: ['Nice', 'Cannes', 'Antibes']). Laisser vide pour ciblage national.",
                },
                "status": {
                    "type": "string",
                    "enum": ["PAUSED", "ENABLED"],
                    "description": "PAUSED par défaut (recommandé). ENABLED pour activer immédiatement.",
                },
                "enhanced_cpc": {
                    "type": "boolean",
                    "description": "Activer l'enchère CPC améliorée (défaut: true)",
                },
            },
            "required": ["name", "daily_budget_euros"],
        },
    },
    {
        "name": "create_ad_group",
        "description": (
            "Créer un groupe d'annonces dans une campagne existante. "
            "Retourne un ad_group_id à utiliser avec add_keywords et create_responsive_search_ad."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "campaign_id": {"type": "string", "description": "ID de la campagne (obtenu via create_campaign ou list_campaigns)"},
                "name": {"type": "string", "description": "Nom du groupe d'annonces"},
                "cpc_max_euros": {"type": "number", "description": "Enchère CPC max par défaut en euros pour ce groupe"},
            },
            "required": ["campaign_id", "name", "cpc_max_euros"],
        },
    },
    {
        "name": "create_responsive_search_ad",
        "description": "Créer une nouvelle annonce responsive search ad (RSA) dans un groupe d'annonces.",
        "input_schema": {
            "type": "object",
            "properties": {
                "ad_group_id": {"type": "string"},
                "headlines": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Liste de 3 à 15 titres (max 30 caractères chacun)",
                },
                "descriptions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Liste de 2 à 4 descriptions (max 90 caractères chacune)",
                },
                "final_url": {"type": "string", "description": "URL de destination de l'annonce"},
            },
            "required": ["ad_group_id", "headlines", "descriptions", "final_url"],
        },
    },
]

# ──────────────────────────── TOOL EXECUTOR ─────────────────────────────────


def execute_tool(ads: GoogleAdsClient, name: str, inputs: dict) -> str:
    """Dispatch a tool call to the Google Ads client and return a JSON string."""
    try:
        dispatch = {
            "get_account_overview": lambda: ads.get_account_overview(inputs["date_range"]),
            "list_campaigns": lambda: ads.list_campaigns(inputs["date_range"]),
            "list_ad_groups": lambda: ads.list_ad_groups(inputs["campaign_id"], inputs.get("date_range", "LAST_30_DAYS")),
            "list_keywords": lambda: ads.list_keywords(inputs["campaign_id"], inputs.get("date_range", "LAST_30_DAYS")),
            "get_search_terms": lambda: ads.get_search_terms(
                inputs["campaign_id"],
                inputs.get("date_range", "LAST_30_DAYS"),
                inputs.get("limit", 50),
            ),
            "list_ads": lambda: ads.list_ads(inputs["ad_group_id"], inputs.get("date_range", "LAST_30_DAYS")),
            "update_campaign_budget": lambda: ads.update_campaign_budget(inputs["campaign_id"], inputs["new_budget_euros"]),
            "set_campaign_status": lambda: ads.set_campaign_status(inputs["campaign_id"], inputs["status"]),
            "update_ad_group_bid": lambda: ads.update_ad_group_bid(inputs["ad_group_id"], inputs["new_cpc_max_euros"]),
            "add_keywords": lambda: ads.add_keywords(inputs["ad_group_id"], inputs["keywords"]),
            "set_keyword_status": lambda: ads.set_keyword_status(inputs["ad_group_id"], inputs["criterion_id"], inputs["status"]),
            "update_keyword_bid": lambda: ads.update_keyword_bid(inputs["ad_group_id"], inputs["criterion_id"], inputs["new_cpc_max_euros"]),
            "add_negative_keywords": lambda: ads.add_negative_keywords(inputs["campaign_id"], inputs["keywords"]),
            "create_campaign": lambda: ads.create_campaign(
                inputs["name"],
                inputs["daily_budget_euros"],
                inputs.get("cities"),
                inputs.get("status", "PAUSED"),
                inputs.get("enhanced_cpc", True),
            ),
            "create_ad_group": lambda: ads.create_ad_group(
                inputs["campaign_id"],
                inputs["name"],
                inputs["cpc_max_euros"],
            ),
            "create_responsive_search_ad": lambda: ads.create_responsive_search_ad(
                inputs["ad_group_id"],
                inputs["headlines"],
                inputs["descriptions"],
                inputs["final_url"],
            ),
        }
        result = dispatch[name]()
        return json.dumps(result, ensure_ascii=False, indent=2)
    except KeyError as e:
        return json.dumps({"erreur": f"Outil inconnu ou paramètre manquant: {e}"})
    except Exception as e:
        logger.exception("Tool %s failed", name)
        return json.dumps({"erreur": str(e)})


# ──────────────────────────── AGENT LOOP ────────────────────────────────────


def run_agent(task: str) -> None:
    """Run the Google Ads agent on a single task until completion."""
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    ads = GoogleAdsClient()

    messages: list[dict] = [{"role": "user", "content": task}]
    turn = 0

    while turn < MAX_TURNS:
        turn += 1
        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        # Collect text output and tool calls from this response
        text_blocks = []
        tool_use_blocks = []
        for block in response.content:
            if block.type == "text":
                text_blocks.append(block.text)
            elif block.type == "tool_use":
                tool_use_blocks.append(block)

        if text_blocks:
            print("\n".join(text_blocks), flush=True)

        if response.stop_reason == "end_turn":
            break

        if response.stop_reason == "tool_use":
            # Add assistant message with all content blocks
            messages.append({"role": "assistant", "content": response.content})

            # Execute all tool calls and build tool_result blocks
            tool_results = []
            for block in tool_use_blocks:
                print(f"\n[Outil] {block.name}({json.dumps(block.input, ensure_ascii=False)})", flush=True)
                result = execute_tool(ads, block.name, block.input)
                print(f"[Résultat] {result[:300]}{'...' if len(result) > 300 else ''}", flush=True)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result,
                })

            messages.append({"role": "user", "content": tool_results})
            continue

        # Unexpected stop reason
        logger.warning("Unexpected stop_reason: %s", response.stop_reason)
        break


# ──────────────────────────── CLI ───────────────────────────────────────────


def interactive_mode() -> None:
    """Simple REPL for conversational use."""
    print("Julie — Agent Google Ads Loc'Air (tapez 'quitter' pour sortir)")
    print("─" * 60)
    while True:
        try:
            task = input("\nVous : ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nAu revoir !")
            break
        if not task:
            continue
        if task.lower() in {"quitter", "exit", "quit"}:
            print("Au revoir !")
            break
        run_agent(task)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        run_agent(" ".join(sys.argv[1:]))
    else:
        interactive_mode()
