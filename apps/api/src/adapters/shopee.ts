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

function percentValue(value: unknown) {
  const parsed = numberValue(value);
  if (parsed === undefined) return undefined;
  return parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
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

export const shopeeAdapter: MarketplaceAdapter = {
  name: 'shopee',
  async search(input: SearchInput): Promise<NormalizedOffer[]> {
    if (!config.shopeeEnabled) throw new Error('Shopee Affiliate Open API está desabilitada');
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
};
