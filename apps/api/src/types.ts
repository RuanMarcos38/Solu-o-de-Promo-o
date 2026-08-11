export type MarketplaceName = 'mercadolivre' | 'amazon' | 'shopee' | 'magalu' | 'aliexpress' | 'other';

export type SearchInput = {
  keyword: string;
  limit?: number;
  category?: string;
  maxPrice?: number;
};

export type NormalizedOffer = {
  externalId: string;
  marketplace: MarketplaceName;
  title: string;
  normalizedTitle: string;
  category?: string;
  currentPrice: number;
  originalPrice?: number;
  discountPercent?: number;
  imageUrl?: string;
  productUrl: string;
  affiliateUrl?: string;
  affiliateEligible: boolean;
  affiliateProvider?: string;
  affiliateVerifiedAt?: Date;
  sellerName?: string;
  rating?: number;
  freeShipping?: boolean;
  score: number;
};

export type MarketplaceAdapter = {
  name: MarketplaceName;
  search(input: SearchInput): Promise<NormalizedOffer[]>;
};
