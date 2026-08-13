import { createHash, hkdfSync } from 'node:crypto';
import { z } from 'zod';

const readNumber = (name: string, fallback: number) => {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readBoolean = (name: string, fallback: boolean) => {
  const value = process.env[name];
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const readList = (name: string, fallback: string[]) => {
  const value = process.env[name];
  if (!value) return fallback;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
};

const developmentEncryptionKey = Buffer.alloc(32).toString('base64');
const nodeEnv = z.enum(['development', 'test', 'production']).parse(process.env.NODE_ENV || 'development');
const isProduction = nodeEnv === 'production';
const frontendOrigins = readList(
  'FRONTEND_ORIGINS',
  [process.env.FRONTEND_ORIGIN || 'http://localhost:5173']
);
const jwtSecret = process.env.JWT_SECRET || 'change-me-in-production';
const adminEmail = process.env.ADMIN_EMAIL || 'admin@promoradar.local';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123456';
const bootstrapAdminEnabled = readBoolean('BOOTSTRAP_ADMIN_ENABLED', !isProduction);

export type ConfigurationWarning = {
  code: string;
  message: string;
};

export function inspectDatabaseUrl(value: string | undefined, production = false) {
  if (!value?.trim()) return 'DATABASE_URL não configurada';

  try {
    const parsed = new URL(value.trim());
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
      return 'DATABASE_URL precisa ser uma conexão PostgreSQL, não uma URL HTTP do Supabase';
    }
    if (!parsed.hostname || !parsed.username) return 'DATABASE_URL precisa informar host e usuário';
    if (production && !parsed.password) return 'DATABASE_URL precisa informar a senha do usuário do banco';
    if (production && parsed.searchParams.get('schema') !== 'zenite_ofertas') {
      return 'DATABASE_URL de produção precisa usar schema=zenite_ofertas para manter o projeto isolado';
    }
    return undefined;
  } catch {
    return 'DATABASE_URL possui formato inválido';
  }
}

export function resolveChannelEncryptionKey(
  rawValue: string | undefined,
  signingSecret: string,
  production = false
) {
  const value = rawValue?.trim();

  if (value && /^[a-f\d]{64}$/i.test(value)) {
    return { key: Buffer.from(value, 'hex').toString('base64'), source: 'hex' as const };
  }

  if (value && /^[A-Za-z\d+/]+={0,2}$/.test(value) && value.length % 4 === 0) {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length === 32) return { key: decoded.toString('base64'), source: 'base64' as const };
  }

  if (value && Buffer.byteLength(value, 'utf8') >= 32) {
    return {
      key: createHash('sha256').update(value, 'utf8').digest('base64'),
      source: 'passphrase' as const
    };
  }

  if (production) {
    const derived = hkdfSync(
      'sha256',
      Buffer.from(signingSecret, 'utf8'),
      Buffer.from('promotion-radar', 'utf8'),
      Buffer.from('channel-config-encryption-v1', 'utf8'),
      32
    );
    return { key: Buffer.from(derived).toString('base64'), source: 'jwt-derived' as const };
  }

  return { key: developmentEncryptionKey, source: 'development' as const };
}

const encryptionKey = resolveChannelEncryptionKey(
  process.env.CHANNEL_CONFIG_ENCRYPTION_KEY,
  jwtSecret,
  isProduction
);
const channelConfigEncryptionKey = encryptionKey.key;
const configurationWarnings: ConfigurationWarning[] = [];
const databaseConfigurationIssue = inspectDatabaseUrl(process.env.DATABASE_URL, isProduction);

if (isProduction && encryptionKey.source === 'jwt-derived') {
  configurationWarnings.push({
    code: 'CHANNEL_KEY_DERIVED',
    message: 'CHANNEL_CONFIG_ENCRYPTION_KEY ausente ou inválida; usando chave estável derivada do JWT_SECRET'
  });
}

if (databaseConfigurationIssue) {
  configurationWarnings.push({ code: 'DATABASE_URL_INVALID', message: databaseConfigurationIssue });
}

function readOptionalUrl(name: string, fallback?: string) {
  const value = process.env[name]?.trim() || fallback;
  if (!value) return undefined;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && !(nodeEnv !== 'production' && parsed.protocol === 'http:')) {
      throw new Error('protocolo não permitido');
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    configurationWarnings.push({
      code: `${name}_INVALID`,
      message: `${name} foi ignorada porque precisa ser uma URL ${isProduction ? 'HTTPS' : 'HTTP/HTTPS'} válida`
    });
    return undefined;
  }
}

for (const origin of frontendOrigins) {
  const parsed = new URL(origin);
  if (parsed.origin !== origin.replace(/\/$/, '')) {
    throw new Error(`Origem inválida em FRONTEND_ORIGINS: ${origin}`);
  }
}

if (frontendOrigins.some((origin) => origin === '*')) {
  throw new Error('FRONTEND_ORIGINS não pode usar wildcard');
}

if (isProduction) {
  const insecureJwt = jwtSecret.length < 32 || /change-me|troque-por|secret/i.test(jwtSecret);
  if (insecureJwt) {
    throw new Error('JWT_SECRET precisa ter pelo menos 32 caracteres aleatórios em produção');
  }

  if (bootstrapAdminEnabled) {
    const insecureAdminPassword = adminPassword.length < 12 || adminPassword === 'admin123456';
    if (insecureAdminPassword) {
      throw new Error('ADMIN_PASSWORD precisa ter pelo menos 12 caracteres e não pode usar o padrão local');
    }

    z.string().email().parse(adminEmail);
  }
}

export const config = {
  nodeEnv,
  isProduction,
  apiHost: process.env.API_HOST?.trim() || '0.0.0.0',
  apiPort: Math.min(65_535, Math.max(1, Math.floor(readNumber('API_PORT', 3333)))),
  frontendOrigins,
  defaultKeywords: readList('DEFAULT_KEYWORDS', ['iphone', 'smart tv', 'notebook', 'air fryer']),
  minDiscountPercent: Math.max(50, readNumber('MIN_DISCOUNT_PERCENT', 50)),
  minOpportunityScore: readNumber('MIN_OPPORTUNITY_SCORE', 55),
  maxResultsPerSource: readNumber('MAX_RESULTS_PER_SOURCE', 30),
  collectIntervalSeconds: readNumber('COLLECT_INTERVAL_SECONDS', 60),
  requireVerifiedAffiliateLinks: readBoolean('REQUIRE_VERIFIED_AFFILIATE_LINKS', true),
  mercadoLivreSiteId: process.env.MERCADO_LIVRE_SITE_ID || 'MLB',
  mercadoLivreAccessToken: process.env.MERCADO_LIVRE_ACCESS_TOKEN?.trim() || undefined,
  affiliateResolverUrl: readOptionalUrl('AFFILIATE_LINK_RESOLVER_URL'),
  affiliateResolverToken: process.env.AFFILIATE_LINK_RESOLVER_TOKEN?.trim() || undefined,
  amazonEnabled: readBoolean('AMAZON_ENABLED', false),
  amazonCredentialId: process.env.AMAZON_CREATORS_CREDENTIAL_ID?.trim() || undefined,
  amazonCredentialSecret: process.env.AMAZON_CREATORS_CREDENTIAL_SECRET?.trim() || undefined,
  amazonCredentialVersion: process.env.AMAZON_CREATORS_CREDENTIAL_VERSION?.trim() || '3.1',
  amazonPartnerTag: process.env.AMAZON_PARTNER_TAG?.trim() || undefined,
  amazonMarketplace: process.env.AMAZON_MARKETPLACE?.trim() || 'www.amazon.com.br',
  amazonSearchIndex: process.env.AMAZON_SEARCH_INDEX?.trim() || 'All',
  amazonTokenUrl: readOptionalUrl('AMAZON_CREATORS_TOKEN_URL'),
  amazonApiBaseUrl: readOptionalUrl('AMAZON_CREATORS_API_BASE_URL', 'https://creatorsapi.amazon'),
  shopeeEnabled: readBoolean('SHOPEE_ENABLED', false),
  shopeeAppId: process.env.SHOPEE_APP_ID?.trim() || undefined,
  shopeeSecret: process.env.SHOPEE_SECRET?.trim() || undefined,
  shopeeEndpoint: readOptionalUrl('SHOPEE_AFFILIATE_GRAPHQL_URL', 'https://open-api.affiliate.shopee.com.br/graphql'),
  apifyToken: process.env.APIFY_TOKEN?.trim() || process.env.APIFY_API_TOKEN?.trim() || undefined,
  apifyApiBaseUrl: readOptionalUrl('APIFY_API_BASE_URL', 'https://api.apify.com/v2'),
  apifyShopeeActorId: process.env.APIFY_SHOPEE_ACTOR_ID?.trim() || 'xtracto/shopee-search',
  apifyShopeeCountry: process.env.APIFY_SHOPEE_COUNTRY?.trim() || 'br',
  apifyShopeeMaxResults: Math.min(500, Math.max(1, Math.floor(readNumber('APIFY_SHOPEE_MAX_RESULTS', 30)))),
  apifyShopeeTimeoutSeconds: Math.min(300, Math.max(15, Math.floor(readNumber('APIFY_SHOPEE_TIMEOUT_SECONDS', 90)))),
  apifyShopeeMaxRunCostUsd: Math.max(0, readNumber('APIFY_SHOPEE_MAX_RUN_COST_USD', 0.25)),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || (isProduction ? '30m' : '7d'),
  jwtIssuer: process.env.JWT_ISSUER || 'promotion-radar-api',
  jwtAudience: process.env.JWT_AUDIENCE || 'promotion-radar-web',
  adminEmail,
  adminPassword,
  adminName: process.env.ADMIN_NAME || 'Administrador',
  bootstrapAdminEnabled,
  channelConfigEncryptionKey,
  channelConfigEncryptionKeySource: encryptionKey.source,
  databaseConfigurationIssue,
  configurationWarnings,
  outboundHttpTimeoutMs: readNumber('OUTBOUND_HTTP_TIMEOUT_MS', 10_000),
  outboundAllowHttp: readBoolean('ALLOW_INSECURE_OUTBOUND_HTTP', !isProduction),
  allowedPrivateOutboundHosts: readList('ALLOW_PRIVATE_OUTBOUND_HOSTS', []).map((host) => host.toLowerCase()),
  dispatchAttempts: Math.max(1, Math.floor(readNumber('DISPATCH_ATTEMPTS', 5))),
  dispatchBackoffMs: Math.max(1_000, Math.floor(readNumber('DISPATCH_BACKOFF_MS', 10_000))),
  dispatchConcurrency: Math.max(1, Math.floor(readNumber('DISPATCH_CONCURRENCY', 8))),
  dispatchCompletedRetentionSeconds: Math.max(3_600, Math.floor(readNumber('DISPATCH_COMPLETED_RETENTION_SECONDS', 604_800))),
  dispatchFailedRetentionSeconds: Math.max(3_600, Math.floor(readNumber('DISPATCH_FAILED_RETENTION_SECONDS', 1_209_600))),
  dispatchRetentionCount: Math.max(100, Math.floor(readNumber('DISPATCH_RETENTION_COUNT', 10_000)))
};
