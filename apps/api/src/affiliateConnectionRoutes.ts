import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isMarketplaceAffiliateUrl, resolveAffiliateLink } from './affiliate.js';
import {
  getAffiliateConnectionConfig,
  getAffiliateConnectionStatuses,
  removeAffiliateConnectionConfig,
  saveAffiliateConnectionConfig,
  type AffiliateMarketplace
} from './affiliateConnectionStore.js';
import { requireAdmin, requireAuth, requireEditor } from './auth.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { fetchExternal } from './http.js';
import { toMarketplaceEnum, toMarketplaceName } from './marketplace.js';

const marketplaceParamsSchema = z.object({
  marketplace: z.enum(['mercadolivre', 'shopee', 'amazon'])
});

const offerParamsSchema = z.object({ offerId: z.string().trim().min(1).max(140) });
const callbackQuerySchema = z.object({
  code: z.string().trim().min(1).optional(),
  state: z.string().trim().min(16).optional(),
  error: z.string().trim().optional(),
  error_description: z.string().trim().optional()
});

const optionalUrl = z.string().trim().url().max(2048).optional();
const optionalText = z.string().trim().max(500).optional();

const mercadoLivreConfigSchema = z.object({
  accountEmail: z.string().trim().email().max(254).optional(),
  affiliateLabel: optionalText,
  clientId: z.string().trim().max(200).optional(),
  clientSecret: z.string().trim().max(500).optional(),
  redirectUri: optionalUrl,
  resolverUrl: optionalUrl,
  resolverToken: z.string().trim().max(2000).optional()
}).strict();

const shopeeConfigSchema = z.object({
  accountEmail: z.string().trim().email().max(254).optional(),
  affiliateLabel: optionalText,
  appId: z.string().trim().max(200).optional(),
  secret: z.string().trim().max(1000).optional(),
  endpoint: optionalUrl
}).strict();

const amazonConfigSchema = z.object({
  accountEmail: z.string().trim().email().max(254).optional(),
  affiliateLabel: optionalText,
  partnerTag: z.string().trim().max(200).optional(),
  credentialId: z.string().trim().max(500).optional(),
  credentialSecret: z.string().trim().max(2000).optional(),
  tokenUrl: optionalUrl,
  apiBaseUrl: optionalUrl
}).strict();

const manualLinkSchema = z.object({
  affiliateUrl: z.string().trim().url().max(4096)
}).strict();

const batchSchema = z.object({
  marketplace: z.enum(['mercadolivre', 'shopee', 'amazon']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30)
}).default({ limit: 30 });

const oauthStatePrefix = 'affiliate-oauth-mercadolivre-';

function marketplaceName(value: unknown): AffiliateMarketplace {
  const normalized = toMarketplaceName(String(value).toLowerCase().replace(/_/g, ''));
  if (!normalized || !['mercadolivre', 'shopee', 'amazon'].includes(normalized)) {
    throw Object.assign(new Error('Marketplace inválido'), { statusCode: 400 });
  }
  return normalized as AffiliateMarketplace;
}

async function findOffer(rawId: string) {
  const direct = await prisma.offer.findUnique({ where: { id: rawId } });
  if (direct) return direct;

  const separatorIndex = rawId.indexOf('-');
  if (separatorIndex < 1) return null;
  const marketplace = toMarketplaceEnum(rawId.slice(0, separatorIndex));
  const externalId = rawId.slice(separatorIndex + 1);
  if (!marketplace || !externalId) return null;

  return prisma.offer.findUnique({
    where: { marketplace_externalId: { marketplace, externalId } }
  });
}

function schemaForMarketplace(marketplace: AffiliateMarketplace) {
  if (marketplace === 'mercadolivre') return mercadoLivreConfigSchema;
  if (marketplace === 'shopee') return shopeeConfigSchema;
  return amazonConfigSchema;
}

function frontendReturnUrl() {
  const origin = config.frontendOrigins.find((item) => item.startsWith('https://')) ?? config.frontendOrigins[0];
  return origin ? origin.replace(/\/$/, '') : 'http://localhost:5173';
}

async function saveOauthState(state: string, userId: string) {
  const id = `${oauthStatePrefix}${state}`;
  await prisma.platformSetting.upsert({
    where: { id },
    create: {
      id,
      value: {
        userId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      } as Prisma.InputJsonValue,
      updatedBy: userId
    },
    update: {
      value: {
        userId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      } as Prisma.InputJsonValue,
      updatedBy: userId,
      version: { increment: 1 }
    }
  });
}

async function consumeOauthState(state: string) {
  const id = `${oauthStatePrefix}${state}`;
  const row = await prisma.platformSetting.findUnique({ where: { id } });
  if (!row) return undefined;
  await prisma.platformSetting.delete({ where: { id } }).catch(() => undefined);

  const value = row.value && typeof row.value === 'object' && !Array.isArray(row.value)
    ? row.value as Record<string, unknown>
    : {};
  const expiresAt = typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : 0;
  const userId = typeof value.userId === 'string' ? value.userId : undefined;
  if (!userId || !expiresAt || expiresAt < Date.now()) return undefined;
  return { userId };
}

export async function registerAffiliateConnectionRoutes(app: FastifyInstance) {
  app.get('/affiliate/connections', async (request) => {
    await requireAuth(request);
    return { connections: await getAffiliateConnectionStatuses() };
  });

  app.put('/affiliate/connections/:marketplace', async (request) => {
    const currentUser = await requireAdmin(request);
    const { marketplace } = marketplaceParamsSchema.parse(request.params);
    const body = schemaForMarketplace(marketplace).parse(request.body ?? {});
    return {
      connections: await saveAffiliateConnectionConfig(marketplace, body, currentUser.id)
    };
  });

  app.delete('/affiliate/connections/:marketplace', async (request) => {
    const currentUser = await requireAdmin(request);
    const { marketplace } = marketplaceParamsSchema.parse(request.params);
    return {
      connections: await removeAffiliateConnectionConfig(marketplace, currentUser.id)
    };
  });

  app.post('/affiliate/connections/mercadolivre/oauth/start', async (request) => {
    const currentUser = await requireAdmin(request);
    const connection = await getAffiliateConnectionConfig('mercadolivre');
    const clientId = typeof connection.clientId === 'string' ? connection.clientId.trim() : '';
    const clientSecret = typeof connection.clientSecret === 'string' ? connection.clientSecret.trim() : '';
    const redirectUri = typeof connection.redirectUri === 'string' ? connection.redirectUri.trim() : '';

    if (!clientId || !clientSecret || !redirectUri) {
      throw Object.assign(
        new Error('Configure Client ID, Client Secret e URL de retorno do Mercado Livre antes de conectar a conta.'),
        { statusCode: 409 }
      );
    }

    const state = randomBytes(24).toString('hex');
    await saveOauthState(state, currentUser.id);
    const authUrl = new URL('https://auth.mercadolivre.com.br/authorization');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);

    return { authUrl: authUrl.toString(), expiresInSeconds: 600 };
  });

  app.get('/affiliate/connections/mercadolivre/oauth/callback', async (request, reply) => {
    const query = callbackQuerySchema.parse(request.query ?? {});
    const returnUrl = new URL(frontendReturnUrl());

    if (query.error) {
      returnUrl.searchParams.set('affiliate', 'mercadolivre-error');
      returnUrl.searchParams.set('reason', query.error_description || query.error);
      return reply.redirect(returnUrl.toString());
    }

    if (!query.code || !query.state) {
      throw Object.assign(new Error('Retorno OAuth do Mercado Livre incompleto.'), { statusCode: 400 });
    }

    const state = await consumeOauthState(query.state);
    if (!state) {
      throw Object.assign(new Error('Estado OAuth inválido ou expirado.'), { statusCode: 400 });
    }

    const connection = await getAffiliateConnectionConfig('mercadolivre');
    const clientId = typeof connection.clientId === 'string' ? connection.clientId.trim() : '';
    const clientSecret = typeof connection.clientSecret === 'string' ? connection.clientSecret.trim() : '';
    const redirectUri = typeof connection.redirectUri === 'string' ? connection.redirectUri.trim() : '';
    if (!clientId || !clientSecret || !redirectUri) {
      throw Object.assign(new Error('Credenciais OAuth do Mercado Livre não encontradas.'), { statusCode: 409 });
    }

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code: query.code,
      redirect_uri: redirectUri
    });

    const tokenResponse = await fetchExternal('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenBody.toString()
    });

    if (!tokenResponse.ok) {
      throw Object.assign(new Error(`Mercado Livre recusou a conexão OAuth (HTTP ${tokenResponse.status}).`), { statusCode: 502 });
    }

    const token = await tokenResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      user_id?: number | string;
      scope?: string;
    };
    if (!token.access_token) {
      throw Object.assign(new Error('Mercado Livre não retornou access token.'), { statusCode: 502 });
    }

    await saveAffiliateConnectionConfig('mercadolivre', {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      externalUserId: token.user_id ? String(token.user_id) : undefined,
      scope: token.scope,
      tokenExpiresAt: token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000).toISOString()
        : undefined
    }, state.userId);

    returnUrl.searchParams.set('affiliate', 'mercadolivre-connected');
    return reply.redirect(returnUrl.toString());
  });

  app.post('/affiliate/offers/:offerId/manual-link', async (request) => {
    await requireEditor(request);
    const { offerId } = offerParamsSchema.parse(request.params);
    const { affiliateUrl } = manualLinkSchema.parse(request.body ?? {});
    const offer = await findOffer(offerId);
    if (!offer) throw Object.assign(new Error('Oferta não encontrada'), { statusCode: 404 });

    const marketplace = marketplaceName(offer.marketplace);
    if (!isMarketplaceAffiliateUrl(marketplace, affiliateUrl)) {
      throw Object.assign(new Error(`O link informado não pertence ao domínio oficial de ${marketplace}.`), { statusCode: 400 });
    }

    const saved = await prisma.offer.update({
      where: { id: offer.id },
      data: {
        affiliateEligible: true,
        affiliateUrl,
        affiliateProvider: `manual-portal-${marketplace}`,
        affiliateVerifiedAt: new Date()
      }
    });

    return {
      offer: {
        id: saved.id,
        marketplace,
        affiliateEligible: saved.affiliateEligible,
        affiliateUrl: saved.affiliateUrl,
        affiliateProvider: saved.affiliateProvider
      }
    };
  });

  app.post('/affiliate/batch/resolve', async (request) => {
    await requireEditor(request);
    const body = batchSchema.parse(request.body ?? {});
    const marketplaceEnum = body.marketplace ? toMarketplaceEnum(body.marketplace) : undefined;

    const offers = await prisma.offer.findMany({
      where: {
        isActive: true,
        affiliateEligible: false,
        ...(marketplaceEnum ? { marketplace: marketplaceEnum } : {})
      },
      orderBy: [{ score: 'desc' }, { lastSeenAt: 'desc' }],
      take: body.limit
    });

    const affiliated: Array<{ id: string; marketplace: AffiliateMarketplace; affiliateUrl: string }> = [];
    const pending: Array<{ id: string; marketplace: AffiliateMarketplace; reason: string }> = [];

    for (const offer of offers) {
      const marketplace = marketplaceName(offer.marketplace);
      try {
        const resolved = await resolveAffiliateLink({
          marketplace,
          externalId: offer.externalId,
          productUrl: offer.productUrl
        });

        if (!resolved.affiliateEligible || !resolved.affiliateUrl) {
          pending.push({
            id: offer.id,
            marketplace,
            reason: marketplace === 'mercadolivre'
              ? 'Conecte um gerador autorizado ou cole o link criado na Central de Afiliados do Mercado Livre.'
              : 'A conta de afiliado ainda não retornou um link rastreável para esta oferta.'
          });
          continue;
        }

        await prisma.offer.update({
          where: { id: offer.id },
          data: {
            affiliateEligible: true,
            affiliateUrl: resolved.affiliateUrl,
            affiliateProvider: resolved.affiliateProvider,
            affiliateVerifiedAt: resolved.affiliateVerifiedAt ?? new Date()
          }
        });
        affiliated.push({ id: offer.id, marketplace, affiliateUrl: resolved.affiliateUrl });
      } catch (error) {
        pending.push({
          id: offer.id,
          marketplace,
          reason: error instanceof Error ? error.message : 'Falha ao gerar link de afiliado'
        });
      }
    }

    return {
      requested: offers.length,
      affiliatedCount: affiliated.length,
      pendingCount: pending.length,
      affiliated,
      pending
    };
  });
}
