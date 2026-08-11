import { config } from '../config.js';
import { fetchExternal } from '../http.js';
import { calculateDiscount, calculateScore, normalizeTitle } from '../scoring.js';
import type { MarketplaceAdapter, NormalizedOffer, SearchInput } from '../types.js';
import { isMarketplaceAffiliateUrl } from '../affiliate.js';

type Money = { amount?: number; currency?: string; displayAmount?: string };
type AmazonListing = {
  isBuyBoxWinner?: boolean;
  merchantInfo?: { name?: string };
  availability?: { type?: string };
  price?: {
    money?: Money;
    savingBasis?: { money?: Money };
    savings?: { percentage?: number; money?: Money };
  };
};

type AmazonItem = {
  asin?: string;
  detailPageURL?: string;
  images?: { primary?: { medium?: { url?: string }; large?: { url?: string }; small?: { url?: string } } };
  itemInfo?: { title?: { displayValue?: string } };
  browseNodeInfo?: { browseNodes?: Array<{ displayName?: string }> };
  offersV2?: { listings?: AmazonListing[] };
};

type AmazonSearchResponse = {
  searchResult?: { items?: AmazonItem[] };
  errors?: Array<{ code?: string; message?: string }>;
};

type TokenResponse = { access_token?: string; expires_in?: number; token_type?: string };

let cachedToken: { value: string; expiresAt: number } | undefined;

export function amazonTokenEndpoint(version: string) {
  if (version.startsWith('2.')) return 'https://creatorsapi.auth.us-east-1.amazoncognito.com/oauth2/token';
  if (version.startsWith('3.')) return 'https://api.amazon.com/auth/o2/token';
  throw new Error(`Versão de credencial Amazon Creators API não suportada: ${version}`);
}

function isTrackedAmazonUrl(rawUrl: string, partnerTag: string) {
  if (!isMarketplaceAffiliateUrl('amazon', rawUrl)) return false;
  try {
    return new URL(rawUrl).searchParams.get('tag') === partnerTag;
  } catch {
    return false;
  }
}

export function normalizeAmazonItem(item: AmazonItem, partnerTag: string): NormalizedOffer | null {
  const listing = item.offersV2?.listings?.find((entry) => entry.isBuyBoxWinner && entry.price?.money?.amount)
    ?? item.offersV2?.listings?.find((entry) => entry.price?.money?.amount);
  const currentPrice = Number(listing?.price?.money?.amount ?? 0);
  const originalPriceValue = Number(listing?.price?.savingBasis?.money?.amount ?? 0);
  const originalPrice = originalPriceValue > currentPrice ? originalPriceValue : undefined;
  const apiDiscount = Number(listing?.price?.savings?.percentage ?? 0);
  const discountPercent = apiDiscount > 0 ? apiDiscount : calculateDiscount(currentPrice, originalPrice);
  const title = item.itemInfo?.title?.displayValue?.trim();
  const productUrl = item.detailPageURL?.trim();
  const externalId = item.asin?.trim();

  if (!externalId || !title || !productUrl || currentPrice <= 0) return null;
  const affiliateEligible = isTrackedAmazonUrl(productUrl, partnerTag);
  const base: Omit<NormalizedOffer, 'score'> = {
    externalId,
    marketplace: 'amazon',
    title,
    normalizedTitle: normalizeTitle(title),
    category: item.browseNodeInfo?.browseNodes?.[0]?.displayName,
    currentPrice,
    originalPrice,
    discountPercent,
    imageUrl: item.images?.primary?.large?.url ?? item.images?.primary?.medium?.url ?? item.images?.primary?.small?.url,
    productUrl,
    affiliateUrl: affiliateEligible ? productUrl : undefined,
    affiliateEligible,
    affiliateProvider: affiliateEligible ? 'amazon-creators-api' : undefined,
    affiliateVerifiedAt: affiliateEligible ? new Date() : undefined,
    sellerName: listing?.merchantInfo?.name,
    freeShipping: false
  };

  return { ...base, score: calculateScore(base) };
}

async function fetchAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.value;

  const credentialId = config.amazonCredentialId;
  const credentialSecret = config.amazonCredentialSecret;
  if (!credentialId || !credentialSecret) throw new Error('Amazon Creators API sem credential id/secret');

  const version = config.amazonCredentialVersion;
  const tokenUrl = config.amazonTokenUrl ?? amazonTokenEndpoint(version);
  const isV2 = version.startsWith('2.');
  const response = await fetchExternal(tokenUrl, isV2
    ? {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${credentialId}:${credentialSecret}`).toString('base64')}`
        },
        body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'creatorsapi/default' }).toString()
      }
    : {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: credentialId,
          client_secret: credentialSecret,
          scope: 'creatorsapi::default'
        })
      });

  if (!response.ok) throw new Error(`Amazon Creators API OAuth retornou HTTP ${response.status}`);
  const payload = (await response.json()) as TokenResponse;
  if (!payload.access_token) throw new Error('Amazon Creators API não retornou access_token');

  cachedToken = {
    value: payload.access_token,
    expiresAt: now + Math.max(60, Number(payload.expires_in ?? 3600)) * 1000
  };
  return cachedToken.value;
}

export const amazonAdapter: MarketplaceAdapter = {
  name: 'amazon',
  async search(input: SearchInput): Promise<NormalizedOffer[]> {
    if (!config.amazonEnabled) throw new Error('Amazon Creators API está desabilitada');
    if (!config.amazonPartnerTag) throw new Error('Amazon Creators API sem partner tag');

    const accessToken = await fetchAccessToken();
    const itemCount = Math.min(Math.max(input.limit ?? 10, 1), 10);
    const body = {
      keywords: input.keyword,
      itemCount,
      searchIndex: input.category || config.amazonSearchIndex,
      partnerTag: config.amazonPartnerTag,
      marketplace: config.amazonMarketplace,
      ...(input.maxPrice ? { maxPrice: Math.round(input.maxPrice * 100) } : {}),
      resources: [
        'browseNodeInfo.browseNodes',
        'images.primary.large',
        'itemInfo.title',
        'offersV2.listings.availability',
        'offersV2.listings.dealDetails',
        'offersV2.listings.isBuyBoxWinner',
        'offersV2.listings.merchantInfo',
        'offersV2.listings.price',
        'offersV2.listings.type'
      ]
    };

    const response = await fetchExternal(`${config.amazonApiBaseUrl}/catalog/v1/searchItems`, {
      method: 'POST',
      headers: {
        Authorization: config.amazonCredentialVersion.startsWith('2.')
          ? `Bearer ${accessToken}, Version ${config.amazonCredentialVersion}`
          : `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'x-marketplace': config.amazonMarketplace
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) throw new Error(`Amazon Creators API retornou HTTP ${response.status}`);
    const data = (await response.json()) as AmazonSearchResponse;
    const fatalError = data.errors?.find((error) => error.message);
    if (!data.searchResult && fatalError) {
      throw new Error(`Amazon Creators API: ${fatalError.code ?? 'erro'} - ${fatalError.message}`);
    }

    return (data.searchResult?.items ?? [])
      .map((item) => normalizeAmazonItem(item, config.amazonPartnerTag!))
      .filter((item): item is NormalizedOffer => Boolean(item));
  }
};
