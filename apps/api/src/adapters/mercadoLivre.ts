import type { MarketplaceAdapter, NormalizedOffer, SearchInput } from '../types.js';
import { calculateDiscount, calculateScore, normalizeTitle } from '../scoring.js';
import { config } from '../config.js';
import { fetchExternal } from '../http.js';
import { resolveAffiliateLink } from '../affiliate.js';

type MercadoLivreItem = {
  id: string;
  title: string;
  price: number;
  original_price?: number | null;
  permalink: string;
  thumbnail?: string;
  category_id?: string;
  seller?: { nickname?: string };
  shipping?: { free_shipping?: boolean };
};

type MercadoLivreResponse = {
  results?: MercadoLivreItem[];
};

export function normalizeMercadoLivreItem(item: MercadoLivreItem): Omit<NormalizedOffer, 'score'> {
  const currentPrice = Number(item.price ?? 0);
  const originalPrice = item.original_price ? Number(item.original_price) : undefined;
  const discountPercent = calculateDiscount(currentPrice, originalPrice);

  return {
    externalId: item.id,
    marketplace: 'mercadolivre',
    title: item.title,
    normalizedTitle: normalizeTitle(item.title),
    category: item.category_id,
    currentPrice,
    originalPrice,
    discountPercent,
    imageUrl: item.thumbnail?.replace(/^http:\/\//i, 'https://'),
    productUrl: item.permalink,
    affiliateEligible: false,
    sellerName: item.seller?.nickname,
    freeShipping: Boolean(item.shipping?.free_shipping)
  };
}

export const mercadoLivreAdapter: MarketplaceAdapter = {
  name: 'mercadolivre',
  async search(input: SearchInput): Promise<NormalizedOffer[]> {
    if (!config.mercadoLivreAccessToken) {
      throw new Error('Mercado Livre sem access token da aplicação');
    }
    if (config.requireVerifiedAffiliateLinks && !config.affiliateResolverUrl) {
      throw new Error('Mercado Livre sem resolvedor autorizado de links afiliados');
    }
    const params = new URLSearchParams({
      q: input.keyword,
      limit: String(input.limit ?? config.maxResultsPerSource)
    });

    const url = `https://api.mercadolibre.com/sites/${encodeURIComponent(config.mercadoLivreSiteId)}/search?${params.toString()}`;
    const response = await fetchExternal(url, {
      headers: { Authorization: `Bearer ${config.mercadoLivreAccessToken}` }
    });

    if (!response.ok) {
      throw new Error(`Mercado Livre API error: ${response.status}`);
    }

    const data = (await response.json()) as MercadoLivreResponse;

    const results = Array.isArray(data.results) ? data.results : [];
    return Promise.all(results.map(async (item) => {
      const base = normalizeMercadoLivreItem(item);
      const affiliate = await resolveAffiliateLink({
        marketplace: 'mercadolivre',
        externalId: base.externalId,
        productUrl: base.productUrl
      });
      const resolved = { ...base, ...affiliate };
      return { ...resolved, score: calculateScore(resolved) };
    }));
  }
};
