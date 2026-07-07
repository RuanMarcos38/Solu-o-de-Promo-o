import type { MarketplaceAdapter, NormalizedOffer, SearchInput } from '../types.js';

export const amazonAdapter: MarketplaceAdapter = {
  name: 'amazon',
  async search(_input: SearchInput): Promise<NormalizedOffer[]> {
    // Produção: implementar com Amazon Creators API ou Associates usando credenciais oficiais.
    return [];
  }
};
