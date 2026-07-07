import type { NormalizedOffer } from './types.js';
import { isApprovedOffer } from './scoring.js';

const offers = new Map<string, NormalizedOffer & { firstSeenAt: string; lastSeenAt: string }>();

export function upsertOffers(items: NormalizedOffer[]) {
  const approved: Array<NormalizedOffer & { firstSeenAt: string; lastSeenAt: string }> = [];

  for (const item of items) {
    if (!isApprovedOffer(item)) continue;

    const key = `${item.marketplace}:${item.externalId}`;
    const now = new Date().toISOString();
    const existing = offers.get(key);
    const stored = {
      ...item,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now
    };

    offers.set(key, stored);
    approved.push(stored);
  }

  return approved;
}

export function listOffers() {
  return Array.from(offers.values()).sort((a, b) => b.score - a.score || b.discountPercent! - a.discountPercent!);
}

export function getStats() {
  const all = listOffers();
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
