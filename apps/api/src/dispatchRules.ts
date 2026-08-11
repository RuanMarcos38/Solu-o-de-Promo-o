import { createHash } from 'node:crypto';

export type OfferForDispatch = {
  id: string;
  title: string;
  currentPrice: number;
  discountPercent?: number;
  productUrl: string;
  affiliateUrl?: string;
  affiliateEligible: boolean;
  marketplace: string;
  score: number;
};

export type AlertForMatch = {
  name: string;
  keywords: string[];
  marketplaces: string[];
  minDiscountPercent: number;
  maxPrice: unknown;
};

function normalize(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

export function formatOfferMessage(offer: OfferForDispatch) {
  if (!offer.affiliateEligible || !offer.affiliateUrl) {
    throw new Error('Oferta sem link afiliado verificado');
  }
  const price = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(offer.currentPrice);
  const discount = offer.discountPercent ? `\n🔥 Desconto: ${offer.discountPercent}% OFF` : '';
  return `🚨 Oferta encontrada!\n\n${offer.title}\n💰 ${price}${discount}\n⭐ Score: ${offer.score}\n🛒 ${offer.affiliateUrl}`;
}

export function checkMarketplaceChannelPolicy(
  offer: OfferForDispatch,
  channelType: string,
  channelConfig: Record<string, unknown>
) {
  if (!offer.affiliateEligible || !offer.affiliateUrl) {
    return { allowed: false, reason: 'affiliate_link_not_verified' } as const;
  }

  if (offer.marketplace.toLowerCase() !== 'mercado_livre' && offer.marketplace.toLowerCase() !== 'mercadolivre') {
    return { allowed: true } as const;
  }

  if (channelType === 'whatsapp' || channelType === 'evolution') {
    return { allowed: false, reason: 'mercado_livre_closed_group_restricted' } as const;
  }

  if (channelType === 'telegram' && channelConfig.audience !== 'public') {
    return { allowed: false, reason: 'mercado_livre_requires_public_channel' } as const;
  }

  return { allowed: true } as const;
}

export function offerMatchesAlert(offer: OfferForDispatch, alert: AlertForMatch) {
  const title = normalize(offer.title);
  const marketplace = normalize(offer.marketplace);
  const alertMarketplaces = alert.marketplaces.map(normalize).filter(Boolean);
  const alertKeywords = alert.keywords.map(normalize).filter(Boolean);
  const discount = offer.discountPercent ?? 0;
  const maxPrice = alert.maxPrice === null || alert.maxPrice === undefined ? null : Number(alert.maxPrice);

  if (alertMarketplaces.length > 0 && !alertMarketplaces.includes(marketplace)) return false;
  if (alertKeywords.length > 0 && !alertKeywords.some((keyword) => title.includes(keyword))) return false;
  if (discount < alert.minDiscountPercent) return false;
  if (maxPrice !== null && Number.isFinite(maxPrice) && offer.currentPrice > maxPrice) return false;
  return true;
}

export function buildDispatchIdempotencyKey(
  offer: OfferForDispatch,
  channelId: string,
  eventScope = 'production'
) {
  const fingerprint = JSON.stringify({
    eventScope,
    offerId: offer.id,
    channelId,
    currentPrice: offer.currentPrice,
    discountPercent: offer.discountPercent ?? null,
    score: offer.score,
    targetUrl: offer.affiliateUrl ?? null
  });

  return createHash('sha256').update(fingerprint).digest('hex');
}
