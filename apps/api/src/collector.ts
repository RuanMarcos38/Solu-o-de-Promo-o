import { adapters } from './adapters/index.js';
import { config } from './config.js';
import { upsertOffers } from './offerStore.js';
import type { MarketplaceName } from './types.js';

export async function runCollection(options?: { keyword?: string; marketplace?: MarketplaceName }) {
  const keywords = options?.keyword ? [options.keyword] : config.defaultKeywords;
  const selectedAdapters = options?.marketplace ? adapters.filter((adapter) => adapter.name === options.marketplace) : adapters;
  const approved = [];
  const errors = [];

  for (const adapter of selectedAdapters) {
    for (const keyword of keywords) {
      try {
        const found = await adapter.search({ keyword, limit: config.maxResultsPerSource });
        const saved = await upsertOffers(found);
        approved.push(...saved);
      } catch (error) {
        errors.push({ marketplace: adapter.name, keyword, error: error instanceof Error ? error.message : 'Erro desconhecido' });
      }
    }
  }

  return {
    approved,
    errors,
    approvedCount: approved.length
  };
}
