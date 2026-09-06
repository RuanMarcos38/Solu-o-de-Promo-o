import { mercadoLivreAdapter } from './mercadoLivre.js';
import { amazonAdapter } from './amazon.js';
import { hasShopeeApifyFallback, hasShopeeOfficialCredentials } from './shopee.js';
import { shopeeAffiliateV2Adapter } from './shopeeAffiliateV2.js';
import type { MarketplaceAdapter, MarketplaceName } from '../types.js';
import { config } from '../config.js';

export const adapters: MarketplaceAdapter[] = [
  mercadoLivreAdapter,
  amazonAdapter,
  shopeeAffiliateV2Adapter
];

export function getAdapter(name: MarketplaceName) {
  return adapters.find((adapter) => adapter.name === name);
}

type MarketplaceIntegrationStatus = {
  marketplace: 'mercadolivre' | 'amazon' | 'shopee';
  enabled: boolean;
  configured: boolean;
  affiliateLinks: boolean;
  detail: string;
  catalogMode: 'official-api' | 'official-api-with-public-fallback' | 'public-catalog';
  affiliateMode: 'official-api' | 'partner-tag' | 'authorized-resolver' | 'not-configured';
  thirdPartyPaidServiceRequired: false;
  approvalRequired: boolean;
  requirements: string[];
};

export function getMarketplaceStatuses(): MarketplaceIntegrationStatus[] {
  const mercadoLivreAffiliateLinks = Boolean(config.affiliateResolverUrl);
  const amazonOfficialReady = Boolean(
    config.amazonEnabled
    && config.amazonCredentialId
    && config.amazonCredentialSecret
    && config.amazonPartnerTag
  );
  const shopeeOfficialReady = hasShopeeOfficialCredentials();
  const shopeePaidFallbackConfigured = hasShopeeApifyFallback();

  return [
    {
      marketplace: 'mercadolivre',
      enabled: true,
      configured: true,
      affiliateLinks: mercadoLivreAffiliateLinks,
      catalogMode: config.mercadoLivreAccessToken ? 'official-api' : 'official-api-with-public-fallback',
      affiliateMode: mercadoLivreAffiliateLinks ? 'authorized-resolver' : 'not-configured',
      thirdPartyPaidServiceRequired: false,
      approvalRequired: true,
      requirements: [
        'Conta participante do programa Afiliados e Criadores do Mercado Livre',
        'Aplicação/credenciais do ecossistema Mercado Livre quando a busca autenticada for usada',
        'Resolvedor autorizado para transformar anúncios elegíveis em links rastreáveis de afiliado'
      ],
      detail: config.mercadoLivreAccessToken
        ? mercadoLivreAffiliateLinks
          ? 'Busca oficial autenticada e resolvedor autorizado de afiliação configurados. Nenhuma API terceirizada paga é obrigatória.'
          : 'Busca oficial autenticada pronta. A busca funciona sem serviço terceirizado pago; a comissão automática exige um método autorizado pelo programa de afiliados.'
        : mercadoLivreAffiliateLinks
          ? 'Busca publica ativa e resolvedor autorizado de afiliação configurado. Nenhuma API terceirizada paga é obrigatória.'
          : 'Busca publica ativa. Para gerar comissão automaticamente, conecte a conta de afiliado a um método autorizado de geração de links.'
    },
    {
      marketplace: 'amazon',
      enabled: true,
      configured: true,
      affiliateLinks: Boolean(config.amazonPartnerTag),
      catalogMode: amazonOfficialReady ? 'official-api' : 'official-api-with-public-fallback',
      affiliateMode: config.amazonPartnerTag ? (amazonOfficialReady ? 'official-api' : 'partner-tag') : 'not-configured',
      thirdPartyPaidServiceRequired: false,
      approvalRequired: true,
      requirements: [
        'Conta ativa no Programa de Associados da Amazon para o marketplace alvo',
        'Partner Tag da conta de associado',
        'Credenciais da Creators API para a integração oficial de catálogo quando elegível'
      ],
      detail: amazonOfficialReady
        ? 'Amazon Creators API configurada com OAuth 2.0 e Partner Tag. A integração não depende de API terceirizada paga.'
        : config.amazonPartnerTag
          ? 'Busca publica ativa com Partner Tag e fallback de catálogo disponível. Quando sua conta liberar a Amazon Creators API, adicione as credenciais para usar o catálogo oficial.'
          : 'Busca publica ativa. O catálogo pode ser consultado, mas links com comissão exigem uma Partner Tag válida do Programa de Associados da Amazon.'
    },
    {
      marketplace: 'shopee',
      enabled: true,
      configured: true,
      affiliateLinks: shopeeOfficialReady,
      catalogMode: shopeeOfficialReady ? 'official-api' : 'official-api-with-public-fallback',
      affiliateMode: shopeeOfficialReady ? 'official-api' : 'not-configured',
      thirdPartyPaidServiceRequired: false,
      approvalRequired: true,
      requirements: [
        'Conta aprovada no programa de afiliados da Shopee',
        'App ID e Secret da Shopee Affiliate Open API',
        'Uso do offerLink retornado pela API oficial para rastreamento da comissão'
      ],
      detail: shopeeOfficialReady
        ? 'Shopee Affiliate Open API configurada: busca produtos, desconto, comissão e offerLink rastreável da própria conta. Nenhuma API terceirizada paga é obrigatória.'
        : shopeePaidFallbackConfigured
          ? 'Existe descoberta terceirizada opcional, mas o envio com comissão permanece bloqueado até conectar a Shopee Affiliate Open API da conta.'
          : 'Descoberta pública é apenas contingência. Para buscar ofertas já com link de comissão, conecte App ID e Secret da Shopee Affiliate Open API.'
    }
  ];
}
