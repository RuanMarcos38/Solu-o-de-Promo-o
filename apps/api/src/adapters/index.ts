import { mercadoLivreAdapter } from './mercadoLivre.js';
import { amazonAdapter } from './amazon.js';
import type { MarketplaceAdapter, MarketplaceName } from '../types.js';

const disabledAdapters: MarketplaceAdapter[] = [];

export const adapters: MarketplaceAdapter[] = [mercadoLivreAdapter, amazonAdapter, ...disabledAdapters];

export function getAdapter(name: MarketplaceName) {
  return adapters.find((adapter) => adapter.name === name);
}
