import { Prisma } from '@prisma/client';
import { config } from './config.js';
import { prisma } from './db.js';
import { decryptSensitiveConfig, encryptSensitiveConfig, summarizeSensitiveConfig } from './secrets.js';

export type AffiliateMarketplace = 'mercadolivre' | 'shopee' | 'amazon';

const SETTING_ID = 'affiliate-marketplace-connections-v1';

const environmentDefaults = {
  mercadoLivreAccessToken: config.mercadoLivreAccessToken,
  affiliateResolverUrl: config.affiliateResolverUrl,
  affiliateResolverToken: config.affiliateResolverToken,
  shopeeEnabled: config.shopeeEnabled,
  shopeeAppId: config.shopeeAppId,
  shopeeSecret: config.shopeeSecret,
  shopeeEndpoint: config.shopeeEndpoint,
  amazonEnabled: config.amazonEnabled,
  amazonCredentialId: config.amazonCredentialId,
  amazonCredentialSecret: config.amazonCredentialSecret,
  amazonPartnerTag: config.amazonPartnerTag,
  amazonTokenUrl: config.amazonTokenUrl,
  amazonApiBaseUrl: config.amazonApiBaseUrl
};

type StoredConnections = Partial<Record<AffiliateMarketplace, unknown>>;

function asStoredConnections(value: unknown): StoredConnections {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as StoredConnections;
}

function cleanConfig(input: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      result[key] = trimmed;
      continue;
    }
    result[key] = value;
  }
  return result;
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function readStore() {
  const row = await prisma.platformSetting.findUnique({ where: { id: SETTING_ID } });
  return { row, store: asStoredConnections(row?.value) };
}

export async function getAffiliateConnectionConfig(marketplace: AffiliateMarketplace) {
  const { store } = await readStore();
  return decryptSensitiveConfig(store[marketplace]);
}

export async function saveAffiliateConnectionConfig(
  marketplace: AffiliateMarketplace,
  input: Record<string, unknown>,
  updatedBy: string
) {
  const { row, store } = await readStore();
  const existing = decryptSensitiveConfig(store[marketplace]);
  const merged = cleanConfig({ ...existing, ...cleanConfig(input) });
  const nextStore: StoredConnections = {
    ...store,
    [marketplace]: encryptSensitiveConfig(merged)
  };

  if (row) {
    await prisma.platformSetting.update({
      where: { id: SETTING_ID },
      data: {
        value: nextStore as Prisma.InputJsonValue,
        updatedBy,
        version: { increment: 1 }
      }
    });
  } else {
    await prisma.platformSetting.create({
      data: {
        id: SETTING_ID,
        value: nextStore as Prisma.InputJsonValue,
        updatedBy
      }
    });
  }

  await hydrateAffiliateRuntimeConfig();
  return getAffiliateConnectionStatuses();
}

export async function removeAffiliateConnectionConfig(marketplace: AffiliateMarketplace, updatedBy: string) {
  const { row, store } = await readStore();
  if (!row) return getAffiliateConnectionStatuses();

  const nextStore = { ...store };
  delete nextStore[marketplace];

  await prisma.platformSetting.update({
    where: { id: SETTING_ID },
    data: {
      value: nextStore as Prisma.InputJsonValue,
      updatedBy,
      version: { increment: 1 }
    }
  });

  await hydrateAffiliateRuntimeConfig();
  return getAffiliateConnectionStatuses();
}

function resetRuntimeToEnvironment() {
  config.mercadoLivreAccessToken = environmentDefaults.mercadoLivreAccessToken;
  config.affiliateResolverUrl = environmentDefaults.affiliateResolverUrl;
  config.affiliateResolverToken = environmentDefaults.affiliateResolverToken;

  config.shopeeEnabled = environmentDefaults.shopeeEnabled;
  config.shopeeAppId = environmentDefaults.shopeeAppId;
  config.shopeeSecret = environmentDefaults.shopeeSecret;
  config.shopeeEndpoint = environmentDefaults.shopeeEndpoint;

  config.amazonEnabled = environmentDefaults.amazonEnabled;
  config.amazonCredentialId = environmentDefaults.amazonCredentialId;
  config.amazonCredentialSecret = environmentDefaults.amazonCredentialSecret;
  config.amazonPartnerTag = environmentDefaults.amazonPartnerTag;
  config.amazonTokenUrl = environmentDefaults.amazonTokenUrl;
  config.amazonApiBaseUrl = environmentDefaults.amazonApiBaseUrl;
}

function applyRuntimeConfig(
  mercadoLivre: Record<string, unknown>,
  shopee: Record<string, unknown>,
  amazon: Record<string, unknown>
) {
  config.mercadoLivreAccessToken = text(mercadoLivre.accessToken) ?? config.mercadoLivreAccessToken;
  config.affiliateResolverUrl = text(mercadoLivre.resolverUrl) ?? config.affiliateResolverUrl;
  config.affiliateResolverToken = text(mercadoLivre.resolverToken) ?? config.affiliateResolverToken;

  const shopeeAppId = text(shopee.appId);
  const shopeeSecret = text(shopee.secret);
  const shopeeEndpoint = text(shopee.endpoint);
  config.shopeeAppId = shopeeAppId ?? config.shopeeAppId;
  config.shopeeSecret = shopeeSecret ?? config.shopeeSecret;
  config.shopeeEndpoint = shopeeEndpoint ?? config.shopeeEndpoint;
  config.shopeeEnabled = Boolean(config.shopeeAppId && config.shopeeSecret && config.shopeeEndpoint);

  const amazonPartnerTag = text(amazon.partnerTag);
  const amazonCredentialId = text(amazon.credentialId);
  const amazonCredentialSecret = text(amazon.credentialSecret);
  config.amazonPartnerTag = amazonPartnerTag ?? config.amazonPartnerTag;
  config.amazonCredentialId = amazonCredentialId ?? config.amazonCredentialId;
  config.amazonCredentialSecret = amazonCredentialSecret ?? config.amazonCredentialSecret;
  config.amazonTokenUrl = text(amazon.tokenUrl) ?? config.amazonTokenUrl;
  config.amazonApiBaseUrl = text(amazon.apiBaseUrl) ?? config.amazonApiBaseUrl;
  config.amazonEnabled = Boolean(config.amazonPartnerTag);
}

export async function hydrateAffiliateRuntimeConfig() {
  resetRuntimeToEnvironment();
  try {
    const { store } = await readStore();
    applyRuntimeConfig(
      decryptSensitiveConfig(store.mercadolivre),
      decryptSensitiveConfig(store.shopee),
      decryptSensitiveConfig(store.amazon)
    );
  } catch {
    // Mantém os valores de ambiente se o banco estiver temporariamente indisponível.
  }
}

function configuredStatus(
  marketplace: AffiliateMarketplace,
  label: string,
  connection: Record<string, unknown>,
  options: {
    accountConnected: boolean;
    canGenerateAffiliateLinks: boolean;
    connectionMethod: string;
    portalUrl: string;
    note: string;
  }
) {
  return {
    marketplace,
    label,
    configured: Object.keys(connection).length > 0 || options.accountConnected || options.canGenerateAffiliateLinks,
    accountConnected: options.accountConnected,
    canGenerateAffiliateLinks: options.canGenerateAffiliateLinks,
    connectionMethod: options.connectionMethod,
    passwordStored: false,
    accountEmail: text(connection.accountEmail),
    affiliateLabel: text(connection.affiliateLabel),
    portalUrl: options.portalUrl,
    note: options.note,
    configSummary: summarizeSensitiveConfig(connection)
  };
}

export async function getAffiliateConnectionStatuses() {
  let mercadoLivre: Record<string, unknown> = {};
  let shopee: Record<string, unknown> = {};
  let amazon: Record<string, unknown> = {};

  try {
    const { store } = await readStore();
    mercadoLivre = decryptSensitiveConfig(store.mercadolivre);
    shopee = decryptSensitiveConfig(store.shopee);
    amazon = decryptSensitiveConfig(store.amazon);
  } catch {
    // O status de runtime abaixo ainda representa credenciais fornecidas por ambiente.
  }

  return [
    configuredStatus('mercadolivre', 'Mercado Livre', mercadoLivre, {
      accountConnected: Boolean(config.mercadoLivreAccessToken),
      canGenerateAffiliateLinks: Boolean(config.affiliateResolverUrl),
      connectionMethod: 'oauth-2.0',
      portalUrl: 'https://www.mercadolivre.com.br/l/visite-o-portal-de-afiliados',
      note: config.affiliateResolverUrl
        ? 'Conta e resolvedor de links de afiliado prontos para automação.'
        : 'OAuth conecta a conta e o catálogo. Para comissão automática, configure um gerador autorizado de links ou use o link criado no portal oficial.'
    }),
    configuredStatus('shopee', 'Shopee', shopee, {
      accountConnected: Boolean(config.shopeeAppId && config.shopeeSecret),
      canGenerateAffiliateLinks: Boolean(config.shopeeAppId && config.shopeeSecret && config.shopeeEndpoint),
      connectionMethod: 'affiliate-open-api',
      portalUrl: 'https://affiliate.shopee.com.br/',
      note: config.shopeeAppId && config.shopeeSecret
        ? 'Shopee Affiliate Open API pronta para gerar offerLink/shortLink rastreável.'
        : 'Cadastre App ID e Secret liberados para sua conta no programa de afiliados.'
    }),
    configuredStatus('amazon', 'Amazon', amazon, {
      accountConnected: Boolean(config.amazonPartnerTag),
      canGenerateAffiliateLinks: Boolean(config.amazonPartnerTag),
      connectionMethod: 'associates-partner-tag',
      portalUrl: 'https://associados.amazon.com.br/',
      note: config.amazonPartnerTag
        ? 'Partner Tag ativa para atribuir as vendas à sua conta de associado.'
        : 'Cadastre sua Partner Tag do Programa de Associados; credenciais da API podem ser adicionadas para catálogo oficial.'
    })
  ];
}
