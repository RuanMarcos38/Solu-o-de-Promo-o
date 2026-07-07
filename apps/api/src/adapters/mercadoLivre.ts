import type { MarketplaceAdapter, NormalizedOffer, SearchInput } from '../types.js';
import { calculateDiscount, calculateScore, normalizeTitle } from '../scoring.js';
import { config } from '../config.js';

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
  results: MercadoLivreItem[];
};

export const mercadoLivreAdapter: MarketplaceAdapter = {
  name: 'mercadolivre',
  async search(input: SearchInput): Promise<NormalizedOffer[]> {
    const params = new URLSearchParams({
      q: input.keyword,
      limit: String(input.limit ?? config.maxResultsPerSource)
    });

    const url = `https://api.mercadolibre.com/sites/${config.mercadoLivreSiteId}/search?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Mercado Livre API error: ${response.status}`);
    }

    const data = (await response.json()) as MercadoLivreResponse;

    return data.results.map((item) => {
      const currentPrice = Number(item.price ?? 0);
      const originalPrice = item.original_price ? Number(item.original_price) : undefined;
      const discountPercent = calculateDiscount(currentPrice, originalPrice);
      const base = {
        externalId: item.id,
        marketplace: 'mercadolivre' as const,
        title: item.title,
        normalizedTitle: normalizeTitle(item.title),
        category: item.category_id,
        currentPrice,
        originalPrice,
        discountPercent,
        imageUrl: item.thumbnail,
        productUrl: item.permalink,
        affiliateUrl: item.permalink,
        sellerName: item.seller?.nickname,
        freeShipping: Boolean(item.shipping?.free_shipping)
      };

      return {
        ...base,
        score: calculateScore(base)
      };
    });
  }
};
