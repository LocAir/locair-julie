// Lecture des statistiques Google Ads (dépense, clics, conversions...) pour
// le tableau de bord admin. Lecture seule — on ne modifie jamais rien côté
// Google Ads depuis ce module, seulement des rapports.
//
// ── Mise en service (à faire une seule fois, côté propriétaire) ────────────
// 5 variables d'environnement à ajouter sur Vercel (Project Settings →
// Environment Variables) :
//   GOOGLE_ADS_CLIENT_ID        → Google Cloud Console, identifiant OAuth
//   GOOGLE_ADS_CLIENT_SECRET    → idem, le secret associé
//   GOOGLE_ADS_REFRESH_TOKEN    → obtenu une fois via l'écran de consentement
//                                  Google (autorise l'app à lire le compte)
//   GOOGLE_ADS_DEVELOPER_TOKEN  → Google Ads → Outils et paramètres → Centre API
//   GOOGLE_ADS_CUSTOMER_ID      → l'identifiant du compte Google Ads (10
//                                  chiffres en haut à droite de l'interface
//                                  Google Ads), SANS tirets
// Optionnel : GOOGLE_ADS_LOGIN_CUSTOMER_ID si le compte est piloté depuis un
// compte manager (MCC) — sinon laisser vide.
// Tant que ces variables ne sont pas toutes présentes, l'onglet Publicité de
// l'admin affiche un message "pas encore connecté" au lieu de planter.
//
// Google fait vieillir ses versions d'API (~1 an) : si les appels se
// mettent à échouer avec une erreur mentionnant une version, mettre à jour
// la constante ci-dessous avec la version indiquée par Google.
const API_VERSION = 'v19';

function isGoogleAdsConfigured() {
  return Boolean(
    process.env.GOOGLE_ADS_CLIENT_ID &&
    process.env.GOOGLE_ADS_CLIENT_SECRET &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN &&
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_CUSTOMER_ID
  );
}

// Jeton d'accès mis en cache en mémoire (partagé entre requêtes tant que la
// fonction serverless reste "chaude") — évite de redemander un jeton à
// Google à chaque ouverture de l'onglet Publicité.
let _tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt) return _tokenCache.token;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  if (!r.ok) throw new Error('Jeton Google Ads refusé (' + r.status + ')');
  const d = await r.json();
  _tokenCache = { token: d.access_token, expiresAt: Date.now() + (d.expires_in - 60) * 1000 };
  return _tokenCache.token;
}

async function runGaqlQuery(query) {
  const accessToken = await getAccessToken();
  const customerId = String(process.env.GOOGLE_ADS_CUSTOMER_ID).replace(/-/g, '');
  const headers = {
    'Content-Type':    'application/json',
    'Authorization':   'Bearer ' + accessToken,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  };
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    headers['login-customer-id'] = String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/-/g, '');
  }

  const r = await fetch(`https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = body?.error?.message || (r.status + '');
    throw new Error('Google Ads API : ' + msg);
  }
  return body?.results || [];
}

// Petit cache mémoire par période (10 min) — le tableau de bord admin peut
// être ouvert et rafraîchi plusieurs fois par jour ; inutile de refaire un
// appel à Google Ads à chaque fois, et ça protège le quota de l'API.
const _summaryCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

async function getGoogleAdsSummary(startDate, endDate) {
  const cacheKey = startDate + '_' + endDate;
  const cached = _summaryCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const query = `
    SELECT campaign.id, campaign.name, campaign.status,
           metrics.impressions, metrics.clicks, metrics.cost_micros,
           metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status != 'REMOVED'
  `;
  const rows = await runGaqlQuery(query);

  const campaigns = rows.map(row => {
    const m = row.metrics || {};
    const costEuros = (Number(m.costMicros) || 0) / 1_000_000;
    return {
      id:                     row.campaign?.id,
      name:                   row.campaign?.name || 'Campagne',
      status:                 row.campaign?.status || 'UNKNOWN',
      impressions:            Number(m.impressions) || 0,
      clicks:                 Number(m.clicks) || 0,
      cost_euros:             costEuros,
      conversions:            Math.round((Number(m.conversions) || 0) * 10) / 10,
      conversions_value_euros: Number(m.conversionsValue) || 0,
    };
  }).sort((a, b) => b.cost_euros - a.cost_euros);

  const totals = campaigns.reduce((acc, c) => ({
    impressions:             acc.impressions + c.impressions,
    clicks:                  acc.clicks + c.clicks,
    cost_euros:              acc.cost_euros + c.cost_euros,
    conversions:             acc.conversions + c.conversions,
    conversions_value_euros: acc.conversions_value_euros + c.conversions_value_euros,
  }), { impressions: 0, clicks: 0, cost_euros: 0, conversions: 0, conversions_value_euros: 0 });

  const data = {
    ...totals,
    cpc_euros:               totals.clicks > 0 ? totals.cost_euros / totals.clicks : 0,
    cost_per_conversion_euros: totals.conversions > 0 ? totals.cost_euros / totals.conversions : null,
    ctr_pct:                  totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
    campaigns,
  };

  _summaryCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

module.exports = { isGoogleAdsConfigured, getGoogleAdsSummary };
