"""
Génère le Refresh Token OAuth2 pour l'API Google Ads.

Étapes préalables :
1. Aller sur https://console.cloud.google.com
2. Créer un projet (ex: "locair-ads")
3. Activer l'API Google Ads : APIs & Services > Bibliothèque > "Google Ads API"
4. Créer des identifiants : APIs & Services > Identifiants > Créer > OAuth 2.0 > Application de bureau
5. Télécharger le JSON et noter le Client ID et Client Secret

Ensuite lancer ce script :
    python get_refresh_token.py
"""

import sys
import webbrowser
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/adwords"]

OAUTH_CONFIG = {
    "installed": {
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob", "http://localhost"],
    }
}


def main():
    print("=" * 60)
    print("  Génération du Refresh Token Google Ads — Loc'Air")
    print("=" * 60)
    print()

    client_id = input("Client ID (depuis Google Cloud Console) : ").strip()
    client_secret = input("Client Secret : ").strip()

    if not client_id or not client_secret:
        print("Erreur : Client ID et Client Secret requis.")
        sys.exit(1)

    config = {**OAUTH_CONFIG}
    config["installed"]["client_id"] = client_id
    config["installed"]["client_secret"] = client_secret

    flow = InstalledAppFlow.from_client_config(config, SCOPES)

    print()
    print("Ouverture du navigateur pour autoriser l'accès à Google Ads...")
    print("(Si le navigateur ne s'ouvre pas, copiez l'URL affichée ci-dessous)")
    print()

    try:
        creds = flow.run_local_server(port=0, open_browser=True)
    except Exception:
        # Fallback: manual copy-paste flow
        auth_url, _ = flow.authorization_url(prompt="consent")
        print(f"Ouvrez ce lien dans votre navigateur :\n{auth_url}\n")
        code = input("Collez ici le code d'autorisation : ").strip()
        flow.fetch_token(code=code)
        creds = flow.credentials

    print()
    print("=" * 60)
    print("  SUCCÈS — Copiez ces valeurs dans votre fichier .env")
    print("=" * 60)
    print(f"GOOGLE_ADS_CLIENT_ID={client_id}")
    print(f"GOOGLE_ADS_CLIENT_SECRET={client_secret}")
    print(f"GOOGLE_ADS_REFRESH_TOKEN={creds.refresh_token}")
    print()
    print("Ne partagez jamais ces informations.")


if __name__ == "__main__":
    main()
