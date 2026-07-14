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
const channelConfigEncryptionKey = process.env.CHANNEL_CONFIG_ENCRYPTION_KEY || developmentEncryptionKey;

for (const origin of frontendOrigins) {
  const parsed = new URL(origin);
  if (parsed.origin !== origin.replace(/\/$/, '')) {
    throw new Error(`Origem inválida em FRONTEND_ORIGINS: ${origin}`);
  }
}

if (frontendOrigins.some((origin) => origin === '*')) {
  throw new Error('FRONTEND_ORIGINS não pode usar wildcard');
}

let decodedEncryptionKey: Buffer;
try {
  decodedEncryptionKey = Buffer.from(channelConfigEncryptionKey, 'base64');
} catch {
  throw new Error('CHANNEL_CONFIG_ENCRYPTION_KEY precisa estar em base64');
}

if (decodedEncryptionKey.length !== 32) {
  throw new Error('CHANNEL_CONFIG_ENCRYPTION_KEY precisa representar exatamente 32 bytes');
}

if (isProduction) {
  const insecureJwt = jwtSecret.length < 32 || /change-me|troque-por|secret/i.test(jwtSecret);
  if (insecureJwt) {
    throw new Error('JWT_SECRET precisa ter pelo menos 32 caracteres aleatórios em produção');
  }

  if (!process.env.CHANNEL_CONFIG_ENCRYPTION_KEY || channelConfigEncryptionKey === developmentEncryptionKey) {
    throw new Error('CHANNEL_CONFIG_ENCRYPTION_KEY forte e exclusiva é obrigatória em produção');
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
  apiPort: readNumber('API_PORT', 3333),
  frontendOrigins,
  defaultKeywords: readList('DEFAULT_KEYWORDS', ['iphone', 'smart tv', 'notebook', 'air fryer']),
  minDiscountPercent: readNumber('MIN_DISCOUNT_PERCENT', 10),
  minOpportunityScore: readNumber('MIN_OPPORTUNITY_SCORE', 55),
  maxResultsPerSource: readNumber('MAX_RESULTS_PER_SOURCE', 30),
  collectIntervalSeconds: readNumber('COLLECT_INTERVAL_SECONDS', 60),
  mercadoLivreSiteId: process.env.MERCADO_LIVRE_SITE_ID || 'MLB',
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || (isProduction ? '30m' : '7d'),
  jwtIssuer: process.env.JWT_ISSUER || 'promotion-radar-api',
  jwtAudience: process.env.JWT_AUDIENCE || 'promotion-radar-web',
  adminEmail,
  adminPassword,
  adminName: process.env.ADMIN_NAME || 'Administrador',
  bootstrapAdminEnabled,
  channelConfigEncryptionKey,
  outboundHttpTimeoutMs: readNumber('OUTBOUND_HTTP_TIMEOUT_MS', 10_000),
  outboundAllowHttp: readBoolean('ALLOW_INSECURE_OUTBOUND_HTTP', !isProduction),
  allowedPrivateOutboundHosts: readList('ALLOW_PRIVATE_OUTBOUND_HOSTS', []).map((host) => host.toLowerCase())
};
