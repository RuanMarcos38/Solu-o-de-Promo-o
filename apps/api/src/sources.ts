import { Marketplace } from '@prisma/client';
import { config } from './config.js';
import { prisma } from './db.js';
import { toMarketplaceName } from './marketplace.js';
import type { MarketplaceName } from './types.js';

export type CollectionTarget = {
  marketplace: MarketplaceName;
  keyword: string;
};

export async function ensureDefaultSources() {
  const count = await prisma.marketplaceSource.count();
  if (count > 0) return;

  await prisma.marketplaceSource.create({
    data: {
      name: 'Mercado Livre - Padrão',
      marketplace: Marketplace.MERCADO_LIVRE,
      isActive: true,
      keywords: config.defaultKeywords,
      config: {}
    }
  });
}

export async function getCollectionTargets(options?: { keyword?: string; marketplace?: MarketplaceName }) {
  if (options?.keyword) {
    return [{ keyword: options.keyword, marketplace: options.marketplace ?? 'mercadolivre' }];
  }

  const sources = await prisma.marketplaceSource.findMany({ where: { isActive: true } });
  if (sources.length === 0) {
    return config.defaultKeywords.map((keyword) => ({ keyword, marketplace: 'mercadolivre' as const }));
  }

  const targets: CollectionTarget[] = [];
  for (const source of sources) {
    const marketplace = toMarketplaceName(source.marketplace) ?? 'mercadolivre';
    for (const keyword of source.keywords) targets.push({ keyword, marketplace });
  }

  return targets;
}
