import { Marketplace } from '@prisma/client';
import type { MarketplaceName } from './types.js';

const aliases: Record<string, Marketplace> = {
  mercadolivre: Marketplace.MERCADO_LIVRE,
  mercado_livre: Marketplace.MERCADO_LIVRE,
  mercadoLivre: Marketplace.MERCADO_LIVRE,
  amazon: Marketplace.AMAZON,
  shopee: Marketplace.SHOPEE,
  magalu: Marketplace.MAGALU,
  aliexpress: Marketplace.ALIEXPRESS,
  other: Marketplace.OTHER
};

export function toMarketplaceEnum(value?: string | null) {
  if (!value) return undefined;
  return aliases[value] ?? aliases[value.toLowerCase()] ?? (Marketplace as any)[value.toUpperCase()] ?? undefined;
}

export function toMarketplaceName(value?: string | null): MarketplaceName | undefined {
  const mapped = toMarketplaceEnum(value);
  if (!mapped) return undefined;
  if (mapped === Marketplace.MERCADO_LIVRE) return 'mercadolivre';
  return String(mapped).toLowerCase() as MarketplaceName;
}
