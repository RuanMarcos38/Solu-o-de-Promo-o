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
  const mercadoLivreAffiliateLinks = Boolean(config.affiliateResolverUrl);
  const amazonOfficialReady = Boolean(
    config.amazonEnabled
    && config.amazonCredentialId
    && config.amazonCredentialSecret
    && config.amazonPartnerTag
  );
  const shopeeOfficialReady = hasShopeeOfficialCredentials();

  return [
    {
      marketplace: 'mercadolivre',
      enabled: true,
      configured: true,
      affiliateLinks: mercadoLivreAffiliateLinks,
      detail: config.mercadoLivreAccessToken
        ? mercadoLivreAffiliateLinks
          ? 'Busca oficial e resolvedor autorizado de afiliacao configurados.'
          : 'Busca oficial pronta. Para comissao automatica, conecte o resolvedor autorizado do programa de afiliados.'
        : mercadoLivreAffiliateLinks
          ? 'Busca publica ativa com fallback resiliente e resolvedor autorizado de afiliacao configurado.'
          : 'Busca publica ativa com fallback resiliente. Para comissao automatica, conecte OAuth/access token e resolvedor autorizado do programa.'
    },
    {
      marketplace: 'amazon',
      enabled: true,
      configured: true,
      affiliateLinks: Boolean(config.amazonPartnerTag),
      detail: amazonOfficialReady
        ? 'Amazon Creators API configurada com OAuth 2.0 e Partner Tag.'
        : config.amazonPartnerTag
          ? 'Busca publica ativa na Amazon Brasil com Partner Tag. Configure Amazon Creators API para busca oficial mais estavel.'
          : 'Busca publica ativa na Amazon Brasil. Configure AMAZON_PARTNER_TAG e Creators API para gerar links com comissao.'
    },
    {
      marketplace: 'shopee',
      enabled: true,
      configured: true,
      affiliateLinks: shopeeOfficialReady,
      detail: shopeeOfficialReady
        ? 'Shopee Affiliate Open API configurada e pronta para retornar offerLink rastreavel.'
        : hasShopeeApifyFallback()
          ? 'Busca publica direta ativa com Apify como contingencia. Para comissao automatica oficial, configure SHOPEE_APP_ID e SHOPEE_SECRET.'
          : 'Busca publica direta ativa. Para comissao automatica oficial, configure SHOPEE_APP_ID e SHOPEE_SECRET.'
    }
  ];
}
