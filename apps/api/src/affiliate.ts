import { config } from './config.js';
import { fetchExternal } from './http.js';
import type { MarketplaceName } from './types.js';

export type AffiliateResolution = {
  affiliateEligible: boolean;
  affiliateUrl?: string;
  affiliateProvider?: string;
  affiliateVerifiedAt?: Date;
};

type AffiliateResolverResponse = {
  eligible?: boolean;
  affiliateUrl?: string;
  provider?: string;
};

const marketplaceHosts: Record<MarketplaceName, string[]> = {
  mercadolivre: ['mercadolivre.com.br', 'mercadolivre.com', 'mercado.li'],
  amazon: ['amazon.com.br', 'amazon.com', 'amzn.to'],
  shopee: ['shopee.com.br', 's.shopee.com.br'],
  magalu: ['magazineluiza.com.br', 'magalu.com'],
  aliexpress: ['aliexpress.com'],
  other: []
};

function hostnameMatches(hostname: string, allowed: string) {
  return hostname === allowed || hostname.endsWith(`.${allowed}`);
}

function createAmazonAffiliateLink(productUrl: string) {
  if (!config.amazonPartnerTag) return undefined;

  try {
    const parsed = new URL(productUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    if (!marketplaceHosts.amazon.some((host) => hostnameMatches(parsed.hostname.toLowerCase(), host))) return undefined;
    parsed.protocol = 'https:';
    parsed.searchParams.set('tag', config.amazonPartnerTag);
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function createInternalAffiliateLink(origin: string, offerId: string) {
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    parsed.pathname = `/r/${offerId}`;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function isMarketplaceAffiliateUrl(marketplace: MarketplaceName, rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const allowedHosts = marketplaceHosts[marketplace];
    return allowedHosts.length > 0 && allowedHosts.some((host) => hostnameMatches(parsed.hostname.toLowerCase(), host));
  } catch {
    return false;
  }
}

export async function resolveAffiliateLink(input: {
  marketplace: MarketplaceName;
  externalId: string;
  productUrl: string;
}): Promise<AffiliateResolution> {
  if (input.marketplace === 'amazon') {
    const amazonAffiliateUrl = createAmazonAffiliateLink(input.productUrl);
    if (amazonAffiliateUrl && isMarketplaceAffiliateUrl('amazon', amazonAffiliateUrl)) {
      return {
        affiliateEligible: true,
        affiliateUrl: amazonAffiliateUrl,
        affiliateProvider: 'amazon-partner-tag',
        affiliateVerifiedAt: new Date()
      };
    }
  }

  if (!config.affiliateResolverUrl) return { affiliateEligible: false };

  const response = await fetchExternal(config.affiliateResolverUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.affiliateResolverToken ? { Authorization: `Bearer ${config.affiliateResolverToken}` } : {})
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(`Resolvedor de afiliados retornou HTTP ${response.status}`);
  }

  const result = (await response.json()) as AffiliateResolverResponse;
  if (!result.eligible || !result.affiliateUrl) return { affiliateEligible: false };
  if (!isMarketplaceAffiliateUrl(input.marketplace, result.affiliateUrl)) {
    throw new Error(`Resolvedor retornou URL incompatível com ${input.marketplace}`);
  }

  return {
    affiliateEligible: true,
    affiliateUrl: result.affiliateUrl,
    affiliateProvider: result.provider?.trim() || 'authorized-resolver',
    affiliateVerifiedAt: new Date()
  };
}
