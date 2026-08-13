import { mercadoLivreAdapter } from './mercadoLivre.js';
import { amazonAdapter } from './amazon.js';
import { hasShopeeApifyFallback, hasShopeeOfficialCredentials, shopeeAdapter } from './shopee.js';
import type { MarketplaceAdapter, MarketplaceName } from '../types.js';
import { config } from '../config.js';

export const adapters: MarketplaceAdapter[] = [
  mercadoLivreAdapter,
  amazonAdapter,
  shopeeAdapter
];

export function getAdapter(name: MarketplaceName) {
  return adapters.find((adapter) => adapter.name === name);
}

export function getMarketplaceStatuses() {
  return [
    {
      marketplace: 'mercadolivre',
      enabled: true,
      configured: Boolean(config.mercadoLivreAccessToken),
      affiliateLinks: Boolean(config.affiliateResolverUrl),
      detail: config.mercadoLivreAccessToken
        ? config.affiliateResolverUrl
          ? 'Busca oficial e resolvedor autorizado configurados.'
          : 'Busca oficial configurada. Cadastre o resolvedor autorizado para gerar links rastreaveis.'
        : 'Conector ativo para busca. Cadastre MERCADO_LIVRE_ACCESS_TOKEN no EasyPanel para reduzir bloqueios da API oficial.'
    },
    {
      marketplace: 'amazon',
      enabled: true,
      configured: Boolean(config.amazonEnabled && config.amazonCredentialId && config.amazonCredentialSecret && config.amazonPartnerTag),
      affiliateLinks: Boolean(config.amazonPartnerTag),
      detail: config.amazonEnabled && config.amazonCredentialId && config.amazonCredentialSecret && config.amazonPartnerTag
        ? 'Amazon Creators API configurada com OAuth 2.0 e Partner Tag.'
        : 'Busca publica de exibicao ativa. Para links rastreaveis, configure Amazon Creators API e AMAZON_PARTNER_TAG.'
    },
    {
      marketplace: 'shopee',
      enabled: true,
      configured: hasShopeeOfficialCredentials() || hasShopeeApifyFallback(),
      affiliateLinks: hasShopeeOfficialCredentials(),
      detail: hasShopeeOfficialCredentials()
        ? 'Shopee Affiliate Open API configurada e pronta para retornar offerLink rastreavel.'
        : hasShopeeApifyFallback()
          ? 'Busca publica via Apify configurada para resultado imediato. Para offerLink rastreavel, configure Shopee Affiliate Open API.'
          : 'Shopee precisa de APIFY_TOKEN no EasyPanel para busca publica via Apify, ou SHOPEE_APP_ID e SHOPEE_SECRET para links oficiais.'
    }
  ];
}
