import { getAdapter } from './adapters/index.js';
import { config } from './config.js';
import { dispatchOffers } from './dispatch.js';
import { upsertOffers } from './offerStore.js';
import { getCollectionTargets } from './sources.js';
import type { MarketplaceName } from './types.js';

export async function runCollection(options?: { keyword?: string; marketplace?: MarketplaceName }) {
  const targets = await getCollectionTargets(options);
  const approved = [];
  const errors = [];

  for (const target of targets) {
    const adapter = getAdapter(target.marketplace);
    if (!adapter) {
      errors.push({ marketplace: target.marketplace, keyword: target.keyword, error: 'Marketplace sem adaptador ativo' });
      continue;
    }

    try {
      const found = await adapter.search({ keyword: target.keyword, limit: config.maxResultsPerSource });
      const saved = await upsertOffers(found);
      approved.push(...saved);
    } catch (error) {
      errors.push({ marketplace: adapter.name, keyword: target.keyword, error: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
  }

  await dispatchOffers(approved as any);

  return {
    approved,
    errors,
    approvedCount: approved.length
  };
}
