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

const desktopBrowserHeaders = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Upgrade-Insecure-Requests': '1',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

const mobileBrowserHeaders = {
  ...desktopBrowserHeaders,
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
};

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function parseBrazilianCurrency(value: string | undefined) {
  if (!value) return undefined;
  const normalized = decodeHtml(value)
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRating(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(decodeHtml(value).replace(',', '.').match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstMatch(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1];
}

function normalizeAmazonUrl(rawUrl: string, partnerTag?: string) {
  const decoded = decodeHtml(rawUrl.trim());
  const parsed = new URL(decoded, `https://${config.amazonMarketplace}`);
  if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
  parsed.protocol = 'https:';
  parsed.hostname = config.amazonMarketplace.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (partnerTag) parsed.searchParams.set('tag', partnerTag);
  return parsed.toString();
}

export function normalizeAmazonPublicBlock(asin: string, block: string, partnerTag?: string): NormalizedOffer | null {
  const title = decodeHtml(
    firstMatch(block, /<h2[^>]*aria-label="([^"]+)"/i)
      ?? firstMatch(block, /<img[^>]*class="[^"]*\bs-image\b[^"]*"[^>]*alt="([^"]+)"/i)
      ?? firstMatch(block, /<h2[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)
      ?? ''
  ).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const href = firstMatch(block, /href="([^"]*\/dp\/[A-Z0-9]{10}[^"]*)"/i)
    ?? firstMatch(block, /data-cy="title-recipe"[\s\S]*?<a[^>]*href="([^"]+)"/i)
    ?? `/dp/${asin}`;
  const imageUrl = decodeHtml(firstMatch(block, /<img[^>]*class="[^"]*\bs-image\b[^"]*"[^>]*src="([^"]+)"/i) ?? '');
  const priceCandidates = [...block.matchAll(/<span class="a-offscreen">(?:De:\s*)?(R\$\s*[\d.]+,\d{2})<\/span>/g)]
    .map((match) => parseBrazilianCurrency(match[1]))
    .filter((value): value is number => value !== undefined && value > 0);
  const currentPrice = priceCandidates[0] ?? 0;
  const originalPrice = priceCandidates.find((price) => price > currentPrice);
  const rating = parseRating(firstMatch(block, /aria-label="([\d,.]+)\s+de\s+5\s+estrelas/i));

  if (!asin || !title || currentPrice <= 0) return null;

  const productUrl = normalizeAmazonUrl(href);
  const affiliateUrl = partnerTag ? normalizeAmazonUrl(href, partnerTag) : undefined;
  if (!productUrl) return null;
  const base: Omit<NormalizedOffer, 'score'> = {
    externalId: asin,
    marketplace: 'amazon',
    title,
    normalizedTitle: normalizeTitle(title),
    currentPrice,
    originalPrice,
    discountPercent: calculateDiscount(currentPrice, originalPrice),
    imageUrl: imageUrl || undefined,
    productUrl,
    affiliateUrl,
    affiliateEligible: Boolean(affiliateUrl),
    affiliateProvider: affiliateUrl ? 'amazon-partner-tag' : undefined,
    affiliateVerifiedAt: affiliateUrl ? new Date() : undefined,
    rating,
    freeShipping: /Entrega\s+GR[ÁA]TIS|Frete\s+GR[ÁA]TIS/i.test(block)
  };

  return { ...base, score: calculateScore(base) };
}

export function parseAmazonPublicSearch(html: string, partnerTag?: string) {
  const chunks = html.split(/<div role="listitem" data-asin="/i).slice(1);
  const offers = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    if (!/data-component-type="s-search-result"/i.test(chunk)) continue;
    const asin = chunk.match(/^([A-Z0-9]{10})"/)?.[1];
    if (!asin || seen.has(asin)) continue;
    const offer = normalizeAmazonPublicBlock(asin, chunk, partnerTag);
    if (!offer) continue;
    seen.add(asin);
    offers.push(offer);
  }

  return offers;
}

export function amazonTokenEndpoint(version: string) {
  if (version.startsWith('2.')) return 'https://creatorsapi.auth.us-east-1.amazoncognito.com/oauth2/token';
  if (version.startsWith('3.')) return 'https://api.amazon.com/auth/o2/token';
  throw new Error(`Versão de credencial Amazon Creators API não suportada: ${version}`);
}

function cookieHeader(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() ?? [];
  const fallback = response.headers.get('set-cookie');
  return (setCookies.length > 0 ? setCookies : fallback ? [fallback] : [])
    .flatMap((header) => header.split(/,(?=\s*[^;=]+=[^;]+;)/g))
    .map((header) => header.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
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

async function searchAmazonPublic(input: SearchInput) {
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 24);
  const searchUrl = `https://${config.amazonMarketplace.replace(/^https?:\/\//, '').replace(/\/$/, '')}/s?${new URLSearchParams({ k: input.keyword }).toString()}`;
  const response = await fetchExternal(searchUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
    }
  });

  if (!response.ok) throw new Error(`Amazon Brasil retornou HTTP ${response.status}`);
  const html = await response.text();
  const offers = parseAmazonPublicSearch(html, config.amazonPartnerTag);
  if (offers.length === 0) throw new Error('Amazon Brasil não retornou produtos legíveis para esta busca');
  return offers.slice(0, limit);
}

async function searchAmazonPublicResilient(input: SearchInput) {
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 24);
  const host = config.amazonMarketplace.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const query = new URLSearchParams({ k: input.keyword }).toString();
  const urls = [
    `https://${host}/s?${new URLSearchParams({ i: 'aps', k: input.keyword, ref: 'nb_sb_noss' }).toString()}`,
    `https://${host}/s?${query}`,
    `https://${host}/gp/aw/s?${query}`
  ];
  const failures: string[] = [];

  for (const headers of [desktopBrowserHeaders, mobileBrowserHeaders]) {
    let cookies = '';
    try {
      const home = await fetchExternal(`https://${host}/`, { headers });
      cookies = cookieHeader(home);
    } catch {
      cookies = '';
    }

    for (const url of urls) {
      const response = await fetchExternal(url, {
        headers: {
          ...headers,
          Referer: `https://${host}/`,
          ...(cookies ? { Cookie: cookies } : {})
        }
      });

      if (!response.ok) {
        failures.push(`HTTP ${response.status}`);
        continue;
      }

      const html = await response.text();
      const offers = parseAmazonPublicSearch(html, config.amazonPartnerTag);
      if (offers.length > 0) return offers.slice(0, limit);
      failures.push('sem produtos legiveis');
    }
  }

  const reason = [...new Set(failures)].join(', ') || 'bloqueio da vitrine publica';
  throw new Error(`Amazon Brasil nao liberou a busca publica (${reason}). Configure Amazon Creators API para busca oficial.`);
}

export const amazonAdapter: MarketplaceAdapter = {
  name: 'amazon',
  async search(input: SearchInput): Promise<NormalizedOffer[]> {
    if (!config.amazonEnabled || !config.amazonCredentialId || !config.amazonCredentialSecret || !config.amazonPartnerTag) {
      return searchAmazonPublicResilient(input);
    }

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
