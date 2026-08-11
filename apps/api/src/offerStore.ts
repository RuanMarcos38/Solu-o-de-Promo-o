import { Marketplace } from '@prisma/client';
import type { NormalizedOffer } from './types.js';
import { isApprovedOffer, type QualificationCriteria } from './scoring.js';
import { prisma } from './db.js';

const marketplaceMap: Record<string, Marketplace> = {
  mercadolivre: Marketplace.MERCADO_LIVRE,
  mercado_livre: Marketplace.MERCADO_LIVRE,
  amazon: Marketplace.AMAZON,
  shopee: Marketplace.SHOPEE,
  magalu: Marketplace.MAGALU,
  aliexpress: Marketplace.ALIEXPRESS,
  other: Marketplace.OTHER
};

export type OfferFilters = {
  keyword?: string;
  marketplace?: string;
  category?: string;
  minDiscount?: number;
  maxPrice?: number;
  minScore?: number;
  limit?: number;
};

function toApiOffer(offer: any) {
  return {
    ...offer,
    marketplace: String(offer.marketplace).toLowerCase(),
    currentPrice: Number(offer.currentPrice),
    originalPrice: offer.originalPrice === null ? undefined : Number(offer.originalPrice),
    discountPercent: offer.discountPercent === null ? undefined : Number(offer.discountPercent),
    rating: offer.rating === null ? undefined : Number(offer.rating)
  };
}

function toMarketplace(value?: string) {
  if (!value) return undefined;
  return marketplaceMap[value.toLowerCase()] ?? undefined;
}

export async function upsertOffers(items: NormalizedOffer[], criteria?: QualificationCriteria) {
  const fresh = [];

  for (const item of items) {
    if (!isApprovedOffer(item, criteria)) continue;

    const marketplace = marketplaceMap[item.marketplace] ?? Marketplace.OTHER;
    const existing = await prisma.offer.findUnique({
      where: {
        marketplace_externalId: {
          marketplace,
          externalId: item.externalId
        }
      }
    });

    const saved = await prisma.offer.upsert({
      where: {
        marketplace_externalId: {
          marketplace,
          externalId: item.externalId
        }
      },
      create: {
        externalId: item.externalId,
        marketplace,
        title: item.title,
        normalizedTitle: item.normalizedTitle,
        category: item.category,
        currentPrice: item.currentPrice,
        originalPrice: item.originalPrice,
        discountPercent: item.discountPercent,
        imageUrl: item.imageUrl,
        productUrl: item.productUrl,
        affiliateUrl: item.affiliateUrl,
        affiliateEligible: item.affiliateEligible,
        affiliateProvider: item.affiliateProvider,
        affiliateVerifiedAt: item.affiliateVerifiedAt,
        sellerName: item.sellerName,
        rating: item.rating,
        freeShipping: item.freeShipping ?? false,
        score: item.score,
        priceHistory: { create: { price: item.currentPrice } }
      },
      update: {
        title: item.title,
        normalizedTitle: item.normalizedTitle,
        category: item.category,
        currentPrice: item.currentPrice,
        originalPrice: item.originalPrice,
        discountPercent: item.discountPercent,
        imageUrl: item.imageUrl,
        productUrl: item.productUrl,
        affiliateUrl: item.affiliateUrl,
        affiliateEligible: item.affiliateEligible,
        affiliateProvider: item.affiliateProvider,
        affiliateVerifiedAt: item.affiliateVerifiedAt,
        sellerName: item.sellerName,
        rating: item.rating,
        freeShipping: item.freeShipping ?? false,
        score: item.score,
        isActive: true,
        priceHistory: { create: { price: item.currentPrice } }
      }
    });

    const existingPrice = existing ? Number(existing.currentPrice) : null;
    const existingScore = existing?.score ?? 0;
    const shouldPublish = !existing || existingPrice !== item.currentPrice || item.score > existingScore;

    if (shouldPublish) fresh.push(toApiOffer(saved));
  }

  return fresh;
}

export async function listOffers(
  filters: OfferFilters = {},
  pagination: { defaultLimit?: number; maxLimit?: number } = {}
) {
  const where: any = { isActive: true, affiliateEligible: true, affiliateUrl: { not: null } };
  const marketplace = toMarketplace(filters.marketplace);
  if (marketplace) where.marketplace = marketplace;
  if (filters.keyword) where.normalizedTitle = { contains: filters.keyword.toLowerCase(), mode: 'insensitive' };
  if (filters.category) where.category = { contains: filters.category, mode: 'insensitive' };
  if (filters.minDiscount !== undefined) where.discountPercent = { gte: filters.minDiscount };
  if (filters.maxPrice !== undefined) where.currentPrice = { lte: filters.maxPrice };
  if (filters.minScore !== undefined) where.score = { gte: filters.minScore };

  const all = await prisma.offer.findMany({
    where,
    orderBy: [{ score: 'desc' }, { discountPercent: 'desc' }],
    take: Math.min(
      Math.max(filters.limit ?? pagination.defaultLimit ?? 100, 1),
      pagination.maxLimit ?? 200
    )
  });

  return all.map(toApiOffer);
}

export async function getOfferHistory(offerId: string) {
  return prisma.priceHistory.findMany({
    where: { offerId, offer: { affiliateEligible: true, affiliateUrl: { not: null } } },
    orderBy: { capturedAt: 'desc' },
    take: 100
  });
}

export async function getStats() {
  const [totalOffers, bestScore, bestDiscount, byMarketplace] = await Promise.all([
    prisma.offer.count({ where: { isActive: true, affiliateEligible: true } }),
    prisma.offer.findFirst({ where: { isActive: true, affiliateEligible: true }, orderBy: { score: 'desc' } }),
    prisma.offer.findFirst({ where: { isActive: true, affiliateEligible: true }, orderBy: { discountPercent: 'desc' } }),
    prisma.offer.groupBy({ by: ['marketplace'], where: { isActive: true, affiliateEligible: true }, _count: { marketplace: true } })
  ]);

  return {
    totalOffers,
    bestScore: bestScore?.score ?? 0,
    bestDiscount: bestDiscount?.discountPercent ? Number(bestDiscount.discountPercent) : 0,
    marketplaces: Object.fromEntries(byMarketplace.map((item) => [String(item.marketplace).toLowerCase(), item._count.marketplace]))
  };
}
