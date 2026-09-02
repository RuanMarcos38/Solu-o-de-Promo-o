import { createHash } from 'node:crypto';
import { isMarketplaceAffiliateUrl } from '../affiliate.js';
import { config } from '../config.js';
import { fetchExternal } from '../http.js';
import { calculateDiscount, calculateScore, normalizeTitle } from '../scoring.js';
import type { MarketplaceAdapter, NormalizedOffer, SearchInput } from '../types.js';

type ShopeeNode = {
  itemId?: string | number;
  productName?: string;
  productLink?: string;
  offerLink?: string;
  imageUrl?: string;
  shopName?: string;
  price?: string | number;
  priceMin?: string | number;
  priceMax?: string | number;
  originalPrice?: string | number;
  priceBeforeDiscount?: string | number;
  discount?: string | number;
  discountRate?: string | number;
  categoryName?: string;
  ratingStar?: string | number;
  commissionRate?: string | number;
};

type ShopeeResponse = {
  data?: { productOfferV2?: { nodes?: ShopeeNode[] } };
  errors?: Array<{ message?: string }>;
};

type ApifyShopeeItem = Record<string, unknown>;

type ShopeePublicSearchResponse = {
  error?: number | string;
  error_msg?: string;
  items?: Array<Record<string, unknown>>;
  data?: { items?: Array<Record<string, unknown>> };
};

const productOfferQuery = `query ProductOffers($keyword: String!, $page: Int!, $limit: Int!) {
  productOfferV2(keyword: $keyword, page: $page, limit: $limit) {
    nodes {
      itemId
      commissionRate
      price
      sales
      imageUrl
      productName
      shopName
      productLink
      offerLink
      periodStartTime
      periodEndTime
    }
    pageInfo { page limit hasNextPage }
  }
}`;

function numberValue(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function moneyValue(value: unknown) {
  const parsed = numberValue(value);
  if (parsed === undefined) return undefined;
  if (parsed > 1_000_000 && Number.isInteger(parsed)) return Number((parsed / 100_000).toFixed(2));
  if (parsed > 100_000 && Number.isInteger(parsed)) return Number((parsed / 100).toFixed(2));
  return parsed;
}

function percentValue(value: unknown) {
  const parsed = numberValue(value);
  if (parsed === undefined) return undefined;
  return parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
}

function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(segment)) return current[Number(segment)];
    if (typeof current === 'object') return (current as Record<string, unknown>)[segment];
    return undefined;
  }, source);
}

function pickValue(source: unknown, paths: string[]) {
  for (const path of paths) {
    const value = readPath(source, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function stringValue(source: unknown, paths: string[]) {
  const value = pickValue(source, paths);
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).find(Boolean);
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function booleanValue(source: unknown, paths: string[]) {
  const value = pickValue(source, paths);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') return /^(1|true|yes|on|sim|gratis|gr[aá]tis|free)$/i.test(value.trim());
  return undefined;
}

function shopeeProductIdsFromUrl(productUrl?: string) {
  const match = productUrl?.match(/(?:product-)?i\.(\d+)\.(\d+)/i) ?? productUrl?.match(/\/product\/(\d+)\/(\d+)/i);
  return match ? { shopId: match[1], itemId: match[2] } : {};
}

function normalizeShopeeUrl(rawUrl?: string) {
  if (!rawUrl) return undefined;
  if (rawUrl.startsWith('//')) return `https:${rawUrl}`;
  try {
    return new URL(rawUrl, 'https://shopee.com.br').toString();
  } catch {
    return undefined;
  }
}

function normalizeShopeeImage(rawImage?: string) {
  if (!rawImage) return undefined;
  if (/^https?:\/\//i.test(rawImage)) return rawImage.replace(/^http:\/\//i, 'https://');
  if (/^[a-f\d]{16,}$/i.test(rawImage)) return `https://down-br.img.susercontent.com/file/${rawImage}`;
  return rawImage;
}

export function createShopeeSignature(appId: string, timestamp: number, payload: string, secret: string) {
  return createHash('sha256').update(`${appId}${timestamp}${payload}${secret}`).digest('hex');
}

export function normalizeShopeeNode(node: ShopeeNode): NormalizedOffer | null {
  const externalId = String(node.itemId ?? '').trim();
  const title = node.productName?.trim();
  const affiliateUrl = node.offerLink?.trim();
  const productUrl = node.productLink?.trim() || affiliateUrl;
  const currentPrice = numberValue(node.priceMin ?? node.price);
  const originalPriceValue = numberValue(node.originalPrice ?? node.priceBeforeDiscount ?? node.priceMax);
  const originalPrice = currentPrice !== undefined && originalPriceValue !== undefined && originalPriceValue > currentPrice
    ? originalPriceValue
    : undefined;
  const explicitDiscount = percentValue(node.discountRate ?? node.discount);
  const discountPercent = explicitDiscount !== undefined && explicitDiscount >= 0 && explicitDiscount <= 100
    ? explicitDiscount
    : calculateDiscount(currentPrice ?? 0, originalPrice);
  const affiliateEligible = Boolean(affiliateUrl && isMarketplaceAffiliateUrl('shopee', affiliateUrl));

  if (!externalId || !title || !productUrl || currentPrice === undefined || currentPrice <= 0) return null;
  const base: Omit<NormalizedOffer, 'score'> = {
    externalId,
    marketplace: 'shopee',
    title,
    normalizedTitle: normalizeTitle(title),
    category: node.categoryName,
    currentPrice,
    originalPrice,
    discountPercent,
    imageUrl: node.imageUrl,
    productUrl,
    affiliateUrl: affiliateEligible ? affiliateUrl : undefined,
    affiliateEligible,
    affiliateProvider: affiliateEligible ? 'shopee-affiliate-open-api' : undefined,
    affiliateVerifiedAt: affiliateEligible ? new Date() : undefined,
    sellerName: node.shopName,
    rating: numberValue(node.ratingStar),
    freeShipping: false
  };

  return { ...base, score: calculateScore(base) };
}

export function normalizeShopeeApifyItem(item: ApifyShopeeItem): NormalizedOffer | null {
  const productUrl = normalizeShopeeUrl(stringValue(item, [
    'url',
    'productUrl',
    'product_url',
    'productLink',
    'product_link',
    'itemUrl',
    'item_url',
    'link'
  ]));
  const idsFromUrl = shopeeProductIdsFromUrl(productUrl);
  const externalId = String(
    pickValue(item, ['itemId', 'itemid', 'item_id', 'productId', 'product_id', 'id']) ?? idsFromUrl.itemId ?? ''
  ).trim();
  const shopId = String(pickValue(item, ['shopId', 'shopid', 'shop_id']) ?? idsFromUrl.shopId ?? '').trim();
  const title = stringValue(item, ['title', 'name', 'productName', 'product_name', 'itemName', 'item_name']);
  const resolvedUrl = productUrl || (shopId && externalId ? `https://shopee.com.br/product/${shopId}/${externalId}` : undefined);
  const currentPrice = moneyValue(pickValue(item, [
    'price',
    'priceMin',
    'price_min',
    'currentPrice',
    'current_price',
    'price.current',
    'price.value',
    'price_info.current_price'
  ]));
  const originalPriceValue = moneyValue(pickValue(item, [
    'originalPrice',
    'original_price',
    'priceBeforeDiscount',
    'price_before_discount',
    'priceMax',
    'price_max',
    'price.original',
    'price_info.original_price'
  ]));
  const originalPrice = currentPrice !== undefined && originalPriceValue !== undefined && originalPriceValue > currentPrice
    ? originalPriceValue
    : undefined;
  const explicitDiscount = percentValue(pickValue(item, [
    'discount',
    'discountRate',
    'discount_rate',
    'discountPercent',
    'discount_percent',
    'price_info.discount'
  ]));
  const discountPercent = explicitDiscount !== undefined && explicitDiscount >= 0 && explicitDiscount <= 100
    ? explicitDiscount
    : calculateDiscount(currentPrice ?? 0, originalPrice);
  const shippingText = stringValue(item, ['shipping', 'shippingText', 'shipping_text', 'shippingInfo', 'shipping_info']);
  const freeShipping = booleanValue(item, ['freeShipping', 'free_shipping', 'isFreeShipping', 'is_free_shipping'])
    ?? /gr[aá]tis|free/i.test(shippingText ?? '');

  if (!externalId || !title || !resolvedUrl || currentPrice === undefined || currentPrice <= 0) return null;

  const base: Omit<NormalizedOffer, 'score'> = {
    externalId,
    marketplace: 'shopee',
    title,
    normalizedTitle: normalizeTitle(title),
    category: stringValue(item, ['category', 'categoryName', 'category_name']),
    currentPrice,
    originalPrice,
    discountPercent,
    imageUrl: normalizeShopeeImage(stringValue(item, ['image', 'imageUrl', 'image_url', 'thumbnail', 'thumb', 'cover', 'images.0'])),
    productUrl: resolvedUrl,
    affiliateEligible: false,
    sellerName: stringValue(item, ['shopName', 'shop_name', 'sellerName', 'seller_name', 'seller.name', 'shop.name']),
    rating: numberValue(pickValue(item, ['rating', 'ratingStar', 'rating_star', 'itemRating.ratingStar', 'item_rating.rating_star'])),
    freeShipping
  };

  return { ...base, score: calculateScore(base) };
}

export function normalizeShopeePublicItem(item: Record<string, unknown>): NormalizedOffer | null {
  const source = (item.item_basic && typeof item.item_basic === 'object')
    ? item.item_basic as Record<string, unknown>
    : (item.item_data && typeof item.item_data === 'object')
      ? item.item_data as Record<string, unknown>
      : item;
  return normalizeShopeeApifyItem(source);
}

export function hasShopeeOfficialCredentials() {
  return Boolean(config.shopeeAppId && config.shopeeSecret && config.shopeeEndpoint);
}

export function hasShopeeApifyFallback() {
  return Boolean(config.apifyToken && config.apifyApiBaseUrl && config.apifyShopeeActorId);
}

export function buildShopeeApifyInput(input: SearchInput) {
  const limit = Math.min(Math.max(input.limit ?? config.apifyShopeeMaxResults, 1), config.apifyShopeeMaxResults);
  return {
    country: config.apifyShopeeCountry,
    mode: 'keyword',
    keyword: input.keyword,
    sort: 'relevancy',
    maxProducts: limit,
    fetchDetail: false,
    ...(input.maxPrice ? { maxPrice: input.maxPrice } : {})
  };
}

function apifyActorPath(actorId: string) {
  return encodeURIComponent(actorId.trim().replace(/^\/+|\/+$/g, '').replace('/', '~'));
}

function apifyShopeeHttpError(status: number) {
  if (status === 401) return 'Apify rejeitou o token configurado. Atualize APIFY_TOKEN no EasyPanel.';
  if (status === 402 || status === 403 || status === 429) return `Apify Shopee bloqueou a execucao por limite, permissao ou billing HTTP ${status}.`;
  return `Apify Shopee retornou HTTP ${status}.`;
}

function extractApifyItems(payload: unknown): ApifyShopeeItem[] {
  if (Array.isArray(payload)) return payload.filter((item): item is ApifyShopeeItem => Boolean(item) && typeof item === 'object');
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  const collection = Array.isArray(record.items) ? record.items : Array.isArray(record.data) ? record.data : [];
  return collection.filter((item): item is ApifyShopeeItem => Boolean(item) && typeof item === 'object');
}

async function searchShopeePublic(input: SearchInput) {
  const limit = Math.min(Math.max(input.limit ?? config.maxResultsPerSource, 1), 60);
  const url = new URL('https://shopee.com.br/api/v4/search/search_items');
  url.searchParams.set('by', 'relevancy');
  url.searchParams.set('keyword', input.keyword);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('newest', '0');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('page_type', 'search');
  url.searchParams.set('scenario', 'PAGE_GLOBAL_SEARCH');
  url.searchParams.set('version', '2');

  const response = await fetchExternal(url.toString(), {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      Referer: `https://shopee.com.br/search?keyword=${encodeURIComponent(input.keyword)}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
    }
  });

  if (!response.ok) throw new Error(`Shopee busca publica retornou HTTP ${response.status}`);
  const payload = await response.json() as ShopeePublicSearchResponse;
  if (payload.error && String(payload.error) !== '0') {
    throw new Error(`Shopee busca publica bloqueada: ${payload.error_msg || payload.error}`);
  }
  const items = payload.items ?? payload.data?.items ?? [];
  const offers = items.map(normalizeShopeePublicItem).filter((item): item is NormalizedOffer => Boolean(item));
  if (offers.length === 0) throw new Error('Shopee busca publica nao retornou produtos legiveis');
  return offers;
}

async function searchShopeeApify(input: SearchInput) {
  if (!config.apifyToken || !config.apifyApiBaseUrl) throw new Error('Apify sem token ou endpoint configurado no EasyPanel.');

  const actorPath = apifyActorPath(config.apifyShopeeActorId);
  const url = new URL(`${config.apifyApiBaseUrl}/acts/${actorPath}/run-sync-get-dataset-items`);
  url.searchParams.set('timeout', String(config.apifyShopeeTimeoutSeconds));
  url.searchParams.set('maxItems', String(Math.min(Math.max(input.limit ?? config.apifyShopeeMaxResults, 1), config.apifyShopeeMaxResults)));
  if (config.apifyShopeeMaxRunCostUsd > 0) {
    url.searchParams.set('maxTotalChargeUsd', String(config.apifyShopeeMaxRunCostUsd));
  }

  const response = await fetchExternal(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apifyToken}`
    },
    body: JSON.stringify(buildShopeeApifyInput(input))
  }, (config.apifyShopeeTimeoutSeconds + 15) * 1000);

  if (!response.ok) throw new Error(apifyShopeeHttpError(response.status));
  const payload = await response.json();
  const offers = extractApifyItems(payload)
    .map(normalizeShopeeApifyItem)
    .filter((item): item is NormalizedOffer => Boolean(item));
  if (offers.length === 0) throw new Error('Apify Shopee nao retornou produtos legiveis');
  return offers;
}

async function searchShopeeOfficial(input: SearchInput) {
  if (!config.shopeeAppId || !config.shopeeSecret || !config.shopeeEndpoint) {
    throw new Error('Shopee Affiliate Open API sem app id, secret ou endpoint');
  }

  const variables = {
    keyword: input.keyword,
    page: 1,
    limit: Math.min(Math.max(input.limit ?? 20, 1), 50)
  };
  const payload = JSON.stringify({ query: productOfferQuery, variables });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createShopeeSignature(config.shopeeAppId, timestamp, payload, config.shopeeSecret);
  const authorization = `SHA256 Credential=${config.shopeeAppId}, Timestamp=${timestamp}, Signature=${signature}`;

  const response = await fetchExternal(config.shopeeEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization
    },
    body: payload
  });

  if (!response.ok) throw new Error(`Shopee Affiliate Open API retornou HTTP ${response.status}`);
  const data = (await response.json()) as ShopeeResponse;
  const errorMessage = data.errors?.map((error) => error.message).filter(Boolean).join('; ');
  if (errorMessage) throw new Error(`Shopee Affiliate Open API: ${errorMessage}`);

  return (data.data?.productOfferV2?.nodes ?? [])
    .map(normalizeShopeeNode)
    .filter((item): item is NormalizedOffer => Boolean(item));
}

export const shopeeAdapter: MarketplaceAdapter = {
  name: 'shopee',
  async search(input: SearchInput): Promise<NormalizedOffer[]> {
    const errors: string[] = [];

    if (hasShopeeOfficialCredentials()) {
      try {
        const officialOffers = await searchShopeeOfficial(input);
        if (officialOffers.length > 0) return officialOffers;
        errors.push('Shopee Affiliate Open API retornou lista vazia');
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'falha na API oficial da Shopee');
      }
    }

    try {
      return await searchShopeePublic(input);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'falha na busca publica da Shopee');
    }

    if (hasShopeeApifyFallback()) {
      try {
        return await searchShopeeApify(input);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'falha no fallback Apify');
      }
    }

    throw new Error(`Shopee indisponivel para descoberta. ${errors.join(' | ')}`);
  }
};
