import { mercadoLivreAdapter } from './mercadoLivre.js';
import { amazonAdapter } from './amazon.js';
import { shopeeAdapter } from './shopee.js';
import type { MarketplaceAdapter, MarketplaceName } from '../types.js';
import { config } from '../config.js';

export const adapters: MarketplaceAdapter[] = [
  mercadoLivreAdapter,
  ...(config.amazonEnabled ? [amazonAdapter] : []),
  ...(config.shopeeEnabled ? [shopeeAdapter] : [])
];

export function getAdapter(name: MarketplaceName) {
  return adapters.find((adapter) => adapter.name === name);
}

export function getMarketplaceStatuses() {
  return [
    {
      marketplace: 'mercadolivre',
      enabled: true,
      configured: Boolean(config.mercadoLivreAccessToken && config.affiliateResolverUrl),
      affiliateLinks: Boolean(config.affiliateResolverUrl),
      detail: config.affiliateResolverUrl
        ? 'Busca oficial e resolvedor autorizado configurados.'
        : 'Exige token de busca e resolvedor autorizado para gerar links rastreáveis.'
    },
    {
      marketplace: 'amazon',
      enabled: config.amazonEnabled,
      configured: Boolean(config.amazonEnabled && config.amazonCredentialId && config.amazonCredentialSecret && config.amazonPartnerTag),
      affiliateLinks: Boolean(config.amazonEnabled && config.amazonPartnerTag),
      detail: 'Usa Amazon Creators API com OAuth 2.0.'
    },
    {
      marketplace: 'shopee',
      enabled: config.shopeeEnabled,
      configured: Boolean(config.shopeeEnabled && config.shopeeAppId && config.shopeeSecret),
      affiliateLinks: Boolean(config.shopeeEnabled && config.shopeeAppId && config.shopeeSecret),
      detail: 'Usa Shopee Affiliate Open API e aceita apenas offerLink rastreável.'
    }
  ];
}
