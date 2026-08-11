import { getAdapter } from './adapters/index.js';
import { dispatchOffers } from './dispatch.js';
import { upsertOffers } from './offerStore.js';
import { getPlatformSettings } from './runtimeSettings.js';
import { getCollectionTargets } from './sources.js';
import type { MarketplaceName } from './types.js';

export async function runCollection(options?: { keyword?: string; marketplace?: MarketplaceName }) {
  const { settings } = await getPlatformSettings();
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
      const found = await adapter.search({ keyword: target.keyword, limit: settings.collection.maxResultsPerSource });
      const saved = await upsertOffers(found, settings.qualification);
      approved.push(...saved);
    } catch (error) {
      errors.push({ marketplace: adapter.name, keyword: target.keyword, error: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
  }

  if (settings.dispatch.automaticEnabled) {
    await dispatchOffers(approved.slice(0, settings.dispatch.maxOffersPerCycle) as any);
  }

  return {
    approved,
    errors,
    approvedCount: approved.length,
    dispatchEnabled: settings.dispatch.automaticEnabled
  };
}
