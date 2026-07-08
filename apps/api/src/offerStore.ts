import { Marketplace } from '@prisma/client';
import type { NormalizedOffer } from './types.js';
import { isApprovedOffer } from './scoring.js';
import { prisma } from './db.js';

const marketplaceMap: Record<string, Marketplace> = {
  mercadolivre: Marketplace.MERCADO_LIVRE,
  amazon: Marketplace.AMAZON,
  shopee: Marketplace.SHOPEE,
  magalu: Marketplace.MAGALU,
  aliexpress: Marketplace.ALIEXPRESS,
  other: Marketplace.OTHER
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

export async function upsertOffers(items: NormalizedOffer[]) {
  const approved = [];

  for (const item of items) {
    if (!isApprovedOffer(item)) continue;

    const marketplace = marketplaceMap[item.marketplace] ?? Marketplace.OTHER;

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
        sellerName: item.sellerName,
        rating: item.rating,
        freeShipping: item.freeShipping ?? false,
        score: item.score,
        priceHistory: {
          create: { price: item.currentPrice }
        }
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
        sellerName: item.sellerName,
        rating: item.rating,
        freeShipping: item.freeShipping ?? false,
        score: item.score,
        isActive: true,
        priceHistory: {
          create: { price: item.currentPrice }
        }
      }
    });

    approved.push(toApiOffer(saved));
  }

  return approved;
}

export async function listOffers() {
  const all = await prisma.offer.findMany({
    where: { isActive: true },
    orderBy: [{ score: 'desc' }, { discountPercent: 'desc' }],
    take: 100
  });

  return all.map(toApiOffer);
}

export async function getStats() {
  const all = await listOffers();
  const marketplaces = all.reduce<Record<string, number>>((acc, offer) => {
    acc[offer.marketplace] = (acc[offer.marketplace] ?? 0) + 1;
    return acc;
  }, {});

  return {
    totalOffers: all.length,
    bestScore: all[0]?.score ?? 0,
    bestDiscount: Math.max(0, ...all.map((offer) => offer.discountPercent ?? 0)),
    marketplaces
  };
}
