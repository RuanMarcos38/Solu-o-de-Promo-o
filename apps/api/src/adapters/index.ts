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
  const internalAffiliateLinks = true;
  const amazonOfficialReady = Boolean(
    config.amazonEnabled
    && config.amazonCredentialId
    && config.amazonCredentialSecret
    && config.amazonPartnerTag
  );

  return [
    {
      marketplace: 'mercadolivre',
      enabled: true,
      configured: true,
      affiliateLinks: mercadoLivreAffiliateLinks || internalAffiliateLinks,
      detail: config.mercadoLivreAccessToken
        ? mercadoLivreAffiliateLinks
          ? 'Busca oficial e resolvedor autorizado configurados.'
          : 'Busca oficial configurada. Links rastreaveis internos ativos; cadastre resolvedor autorizado para links oficiais.'
        : mercadoLivreAffiliateLinks
          ? 'Busca publica ativa e resolvedor autorizado configurado.'
          : 'Busca publica ativa no Mercado Livre. Links rastreaveis internos ativos; MERCADO_LIVRE_ACCESS_TOKEN e resolvedor autorizado seguem opcionais.'
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
          : 'Busca publica ativa na Amazon Brasil para resultado imediato. Configure AMAZON_PARTNER_TAG e Creators API para links rastreaveis oficiais.'
    },
    {
      marketplace: 'shopee',
      enabled: true,
      configured: hasShopeeOfficialCredentials() || hasShopeeApifyFallback(),
      affiliateLinks: hasShopeeOfficialCredentials() || internalAffiliateLinks,
      detail: hasShopeeOfficialCredentials()
        ? 'Shopee Affiliate Open API configurada e pronta para retornar offerLink rastreavel.'
        : hasShopeeApifyFallback()
          ? 'Busca publica via Apify configurada para resultado imediato. Links rastreaveis internos ativos; configure Shopee Affiliate Open API para offerLink oficial.'
          : 'Shopee precisa de APIFY_TOKEN no EasyPanel para busca publica via Apify, ou SHOPEE_APP_ID e SHOPEE_SECRET para links oficiais.'
    }
  ];
}
