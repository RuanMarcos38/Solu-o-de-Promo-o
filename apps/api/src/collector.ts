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
  const collected = [];
  const errors = [];

  for (const target of targets) {
    const adapter = getAdapter(target.marketplace);
    if (!adapter) {
      errors.push({ marketplace: target.marketplace, keyword: target.keyword, error: 'Marketplace sem adaptador ativo' });
      continue;
    }

    try {
      const found = await adapter.search({ keyword: target.keyword, limit: settings.collection.maxResultsPerSource });
      const criteria = options?.keyword
        ? { ...settings.qualification, minDiscountPercent: 0, minOpportunityScore: 0, requireVerifiedAffiliateLinks: false }
        : settings.qualification;
      const saved = await upsertOffers(found, criteria);
      collected.push(...saved);
      approved.push(...saved.filter((offer) => offer.affiliateEligible && offer.affiliateUrl));
    } catch (error) {
      errors.push({ marketplace: adapter.name, keyword: target.keyword, error: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
  }

  if (settings.dispatch.automaticEnabled) {
    await dispatchOffers(approved.slice(0, settings.dispatch.maxOffersPerCycle) as any);
  }

  return {
    approved,
    offers: options?.keyword ? collected : approved,
    errors,
    approvedCount: approved.length,
    foundCount: collected.length,
    dispatchEnabled: settings.dispatch.automaticEnabled
  };
}
