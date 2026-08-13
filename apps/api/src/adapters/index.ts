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

  return [
    {
      marketplace: 'mercadolivre',
      enabled: true,
      configured: true,
      affiliateLinks: mercadoLivreAffiliateLinks,
      detail: config.mercadoLivreAccessToken
        ? mercadoLivreAffiliateLinks
          ? 'Busca oficial e resolvedor autorizado configurados.'
          : 'Busca oficial configurada. Cadastre o resolvedor autorizado para gerar links rastreaveis.'
        : mercadoLivreAffiliateLinks
          ? 'Busca publica ativa e resolvedor autorizado configurado.'
          : 'Busca publica ativa no Mercado Livre. MERCADO_LIVRE_ACCESS_TOKEN e resolvedor autorizado seguem opcionais para links rastreaveis.'
    },
    {
      marketplace: 'amazon',
      enabled: true,
      configured: amazonOfficialReady,
      affiliateLinks: Boolean(config.amazonPartnerTag),
      detail: amazonOfficialReady
        ? 'Amazon Creators API configurada com OAuth 2.0 e Partner Tag.'
        : 'Credenciais oficiais da Amazon ausentes. Configure Amazon Creators API e AMAZON_PARTNER_TAG no EasyPanel para busca estavel e links rastreaveis.'
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
