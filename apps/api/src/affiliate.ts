import { createHash } from 'node:crypto';
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

type ShopeeShortLinkResponse = {
  data?: {
    generateShortLink?: {
      shortLink?: string;
    } | string;
  };
  errors?: Array<{ message?: string }>;
};

const marketplaceHosts: Record<MarketplaceName, string[]> = {
  mercadolivre: ['mercadolivre.com.br', 'mercadolivre.com', 'mercado.li'],
  amazon: ['amazon.com.br', 'amazon.com', 'amzn.to'],
  shopee: ['shopee.com.br', 's.shopee.com.br', 'shope.ee'],
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

function createShopeeSignature(appId: string, timestamp: number, payload: string, secret: string) {
  return createHash('sha256').update(`${appId}${timestamp}${payload}${secret}`).digest('hex');
}

async function createShopeeAffiliateLink(productUrl: string) {
  if (!config.shopeeAppId || !config.shopeeSecret || !config.shopeeEndpoint) return undefined;

  if (!isMarketplaceAffiliateUrl('shopee', productUrl)) {
    try {
      const parsed = new URL(productUrl);
      if (!marketplaceHosts.shopee.some((host) => hostnameMatches(parsed.hostname.toLowerCase(), host))) return undefined;
    } catch {
      return undefined;
    }
  }

  const query = `mutation GenerateShortLink($input: ShortLinkInput!) {
    generateShortLink(input: $input) {
      shortLink
    }
  }`;
  const payload = JSON.stringify({
    query,
    variables: {
      input: {
        originUrl: productUrl,
        subIds: ['zenite', 'whatsapp']
      }
    }
  });
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

  if (!response.ok) {
    throw new Error(`Shopee Affiliate Open API retornou HTTP ${response.status}`);
  }

  const result = await response.json() as ShopeeShortLinkResponse;
  if (result.errors?.length) {
    throw new Error(result.errors.map((item) => item.message).filter(Boolean).join('; ') || 'Shopee não gerou o link de afiliado');
  }

  const generated = result.data?.generateShortLink;
  const shortLink = typeof generated === 'string' ? generated : generated?.shortLink;
  if (!shortLink) return undefined;
  if (!isMarketplaceAffiliateUrl('shopee', shortLink)) {
    throw new Error('Shopee retornou um link fora dos domínios oficiais esperados');
  }
  return shortLink;
}

export function createInternalAffiliateLink(
  origin: string,
  offerId: string,
  allowUnverified = !config.requireVerifiedAffiliateLinks
) {
  // Um redirect interno ajuda a medir cliques, mas nao transforma o produto em afiliado.
  // Quando links verificados sao obrigatorios, o fallback precisa permanecer bloqueado.
  if (!allowUnverified) return undefined;

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

  if (input.marketplace === 'shopee' && config.shopeeAppId && config.shopeeSecret && config.shopeeEndpoint) {
    const shopeeAffiliateUrl = await createShopeeAffiliateLink(input.productUrl);
    if (shopeeAffiliateUrl) {
      return {
        affiliateEligible: true,
        affiliateUrl: shopeeAffiliateUrl,
        affiliateProvider: 'shopee-affiliate-open-api',
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
