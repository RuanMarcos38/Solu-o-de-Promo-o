import type { NormalizedOffer } from './types.js';
import { config } from './config.js';

export type QualificationCriteria = {
  minDiscountPercent: number;
  minOpportunityScore: number;
  requireVerifiedAffiliateLinks: true;
};

export function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function calculateDiscount(currentPrice: number, originalPrice?: number) {
  if (!originalPrice || originalPrice <= currentPrice) return 0;
  return Number((((originalPrice - currentPrice) / originalPrice) * 100).toFixed(2));
}

export function calculateScore(offer: Omit<NormalizedOffer, 'score'>) {
  const discount = offer.discountPercent ?? 0;
  const hasImage = offer.imageUrl ? 8 : 0;
  const hasSeller = offer.sellerName ? 6 : 0;
  const shipping = offer.freeShipping ? 10 : 0;
  const priceSignal = offer.currentPrice > 0 ? 10 : 0;
  const ratingSignal = offer.rating ? Math.min(10, offer.rating * 2) : 0;
  const affiliateSignal = offer.affiliateEligible && offer.affiliateUrl ? 10 : 0;
  return Math.min(100, Math.round(discount * 1.5 + hasImage + hasSeller + shipping + priceSignal + ratingSignal + affiliateSignal));
}

export function isApprovedOffer(offer: NormalizedOffer, criteria: QualificationCriteria = {
  minDiscountPercent: config.minDiscountPercent,
  minOpportunityScore: config.minOpportunityScore,
  requireVerifiedAffiliateLinks: true
}) {
  const discount = offer.discountPercent ?? 0;
  const affiliateApproved = Boolean(offer.affiliateEligible && offer.affiliateUrl);
  return offer.currentPrice > 0
    && Boolean(offer.productUrl)
    && affiliateApproved
    && discount >= criteria.minDiscountPercent
    && offer.score >= criteria.minOpportunityScore;
}
