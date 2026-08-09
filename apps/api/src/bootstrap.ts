import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { UserRole } from '@prisma/client';
import { Server } from 'socket.io';
import { z, ZodError } from 'zod';
import { ensureAdminUser, hashPassword, login, requireAdmin, requireAuth, requireEditor, safeUser } from './auth.js';
import { runCollection } from './collector.js';
import { config } from './config.js';
import { getOfferHistory, getStats, listOffers } from './offerStore.js';
import { dispatchOffer } from './dispatch.js';
import { prisma } from './db.js';
import { collectOffersQueue, connection, enqueueCollectionJob } from './queue.js';
import { emitNewOffers, emitStats, setRealtimeServer } from './realtime.js';
import { registerMarketplaceEventBridge } from './marketplaceEvents.js';
import { toMarketplaceEnum, toMarketplaceName } from './marketplace.js';
import { ensureDefaultSources } from './sources.js';
import { decryptSensitiveConfig, encryptSensitiveConfig, summarizeSensitiveConfig } from './secrets.js';
import { assertSafeOutboundUrl } from './http.js';

const optionalNumber = z.preprocess(
  (value) => value === undefined || value === null || value === '' ? undefined : Number(value),
  z.number().finite().optional()
);

const offersQuerySchema = z.object({
  keyword: z.string().trim().max(160).optional(),
  marketplace: z.string().trim().max(50).optional(),
  category: z.string().trim().max(120).optional(),
  minDiscount: optionalNumber,
  maxPrice: optionalNumber,
  minScore: optionalNumber,
  limit: optionalNumber
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256)
});

const collectionSchema = z.object({
  keyword: z.string().trim().min(1).max(160).optional(),
  marketplace: z.string().trim().max(50).optional()
}).default({});

const idParamsSchema = z.object({ id: z.string().trim().min(1).max(100) });
const offerIdParamsSchema = z.object({ offerId: z.string().trim().min(1).max(100) });

const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  role: z.nativeEnum(UserRole).default(UserRole.VIEWER),
  isActive: z.boolean().optional().default(true)
});

const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().max(254).optional(),
  password: z.string().min(12).max(128).optional(),
  role: z.nativeEnum(UserRole).optional(),
  isActive: z.boolean().optional()
}).refine((body) => Object.keys(body).length > 0, 'Informe pelo menos um campo para atualização');

const sourceCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  marketplace: z.string().trim().min(1).max(50),
  isActive: z.boolean().optional().default(true),
  keywords: z.union([z.array(z.string()), z.string()]).optional().default([]),
  config: z.record(z.unknown()).optional().default({})
});

const sourceUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  marketplace: z.string().trim().min(1).max(50).optional(),
  isActive: z.boolean().optional(),
  keywords: z.union([z.array(z.string()), z.string()]).optional(),
  config: z.record(z.unknown()).optional()
}).refine((body) => Object.keys(body).length > 0, 'Informe pelo menos um campo para atualização');

const alertCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  keywords: z.union([z.array(z.string()), z.string()]).optional().default([]),
  marketplaces: z.union([z.array(z.string()), z.string()]).optional().default([]),
  minDiscountPercent: z.coerce.number().int().min(0).max(100).optional().default(10),
  maxPrice: z.coerce.number().nonnegative().nullable().optional().default(null),
  isActive: z.boolean().optional().default(true)
});

const alertUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  keywords: z.union([z.array(z.string()), z.string()]).optional(),
  marketplaces: z.union([z.array(z.string()), z.string()]).optional(),
  minDiscountPercent: z.coerce.number().int().min(0).max(100).optional(),
  maxPrice: z.coerce.number().nonnegative().nullable().optional(),
  isActive: z.boolean().optional()
}).refine((body) => Object.keys(body).length > 0, 'Informe pelo menos um campo para atualização');

const channelTypeSchema = z.enum(['telegram', 'whatsapp', 'evolution', 'webhook']);
const channelCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: channelTypeSchema,
  config: z.record(z.unknown()).optional().default({}),
  isActive: z.boolean().optional().default(true)
});

const channelUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  type: channelTypeSchema.optional(),
  config: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional()
}).refine((body) => Object.keys(body).length > 0, 'Informe pelo menos um campo para atualização');

function parseKeywords(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function safeConfigSummary(value: unknown) {
  try {
    return { readable: true, ...summarizeSensitiveConfig(value) };
  } catch {
    return { readable: false, encrypted: true };
  }
}

function toSafeSource(source: any) {
  const { config: sourceConfig, ...safeSource } = source;
  return { ...safeSource, configSummary: safeConfigSummary(sourceConfig) };
}

function toSafeChannel(channel: any) {
  const { config: channelConfig, ...safeChannel } = channel;
  return { ...safeChannel, configSummary: safeConfigSummary(channelConfig) };
}

async function validateConfiguredUrl(value: unknown) {
  if (typeof value === 'string' && value.trim()) await assertSafeOutboundUrl(value.trim());
}

async function validateChannelConfig(type: string, channelConfig: Record<string, unknown>) {
  if (type === 'webhook' || type === 'whatsapp') await validateConfiguredUrl(channelConfig.url);
  if (type === 'evolution') await validateConfiguredUrl(channelConfig.baseUrl);
}

async function getSystemStatus() {
  const [queueCounts, totalOffers, activeSources, activeAlerts, activeChannels, failedDispatches, sentDispatches] = await Promise.all([
    collectOffersQueue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
    prisma.offer.count({ where: { isActive: true } }),
    prisma.marketplaceSource.count({ where: { isActive: true } }),
    prisma.alertRule.count({ where: { isActive: true } }),
    prisma.dispatchChannel.count({ where: { isActive: true } }),
    prisma.dispatchLog.count({ where: { status: 'FAILED' } }),
    prisma.dispatchLog.count({ where: { status: 'SENT' } })
  ]);

  return {
    status: 'ok',
    database: 'ok',
    redis: 'ok',
    queue: queueCounts,
    totals: {
      offers: totalOffers,
      activeSources,
      activeAlerts,
      activeChannels,
      sentDispatches,
      failedDispatches
    }
  };
}

export async function createApp() {
  const app = Fastify({
    logger: true,
    bodyLimit: 1_000_000,
    trustProxy: config.isProduction ? 1 : false,
    requestIdHeader: 'x-request-id'
  });

  const io = new Server(app.server, {
    cors: { origin: config.frontendOrigins, methods: ['GET', 'POST'] }
  });
  setRealtimeServer(io);

  await app.register(cors, {
    origin: config.frontendOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        message: 'Dados inválidos',
        issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
      });
    }

    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode >= 500) request.log.error({ err: error }, 'request failed');

    return reply.status(statusCode).send({
      message: statusCode >= 500 && config.isProduction ? 'Erro interno do servidor' : error.message
    });
  });

  let subscriber: Awaited<ReturnType<typeof registerMarketplaceEventBridge>> | null = null;
  try {
    subscriber = await registerMarketplaceEventBridge(io);
  } catch (error) {
    app.log.warn({ err: error }, 'Redis event bridge unavailable; API started in degraded mode');
  }
  await ensureAdminUser();
  await ensureDefaultSources();

  app.addHook('onClose', async () => {
    io.close();
    if (subscriber?.status !== 'end') {
      try {
        await subscriber?.quit();
      } catch {
        subscriber?.disconnect();
      }
    }
  });

  app.get('/health', async () => ({ status: 'ok', service: 'promotion-radar-api' }));

  app.get('/ready', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await connection.ping();
      return { status: 'ready', database: 'ok', redis: 'ok' };
    } catch (error) {
      return reply.status(503).send({
        status: 'not_ready',
        error: config.isProduction ? 'Dependência indisponível' : error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }
  });

  app.post('/auth/login', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await login(body.email, body.password);
    if (!result) return reply.status(401).send({ message: 'E-mail ou senha inválidos' });
    return result;
  });

  app.get('/auth/me', async (request) => ({ user: await requireAuth(request) }));

  app.get('/offers', async (request) => ({ offers: await listOffers(offersQuerySchema.parse(request.query)) }));
  app.get('/offers/stats', async () => getStats());
  app.get('/offers/:id/history', async (request) => {
    const params = idParamsSchema.parse(request.params);
    return { history: await getOfferHistory(params.id) };
  });

  app.post('/collect/run', async (request) => {
    await requireEditor(request);
    const body = collectionSchema.parse(request.body ?? {});
    const result = await runCollection({ keyword: body.keyword, marketplace: toMarketplaceName(body.marketplace) });
    emitNewOffers(result.approved);
    emitStats(await getStats());
    return result;
  });

  app.post('/collect/enqueue', async (request) => {
    await requireEditor(request);
    const body = collectionSchema.parse(request.body ?? {});
    const job = await enqueueCollectionJob({ keyword: body.keyword, marketplace: toMarketplaceName(body.marketplace) });
    return { status: 'queued', jobId: job.id };
  });

  app.get('/admin/system', async (request) => {
    await requireAdmin(request);
    return getSystemStatus();
  });

  app.get('/admin/users', async (request) => {
    await requireAdmin(request);
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
    return { users: users.map(safeUser) };
  });

  app.post('/admin/users', async (request, reply) => {
    await requireAdmin(request);
    const body = userCreateSchema.parse(request.body);
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email.toLowerCase(),
        passwordHash: await hashPassword(body.password),
        role: body.role,
        isActive: body.isActive
      }
    });
    return reply.status(201).send({ user: safeUser(user) });
  });

  app.put('/admin/users/:id', async (request) => {
    const currentUser = await requireAdmin(request);
    const params = idParamsSchema.parse(request.params);
    const body = userUpdateSchema.parse(request.body);

    if (params.id === currentUser.id && body.isActive === false) {
      throw Object.assign(new Error('Você não pode desativar o próprio usuário'), { statusCode: 400 });
    }

    const user = await prisma.user.update({
      where: { id: params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.email !== undefined ? { email: body.email.toLowerCase() } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.password !== undefined ? { passwordHash: await hashPassword(body.password) } : {})
      }
    });
    return { user: safeUser(user) };
  });

  app.get('/admin/sources', async (request) => {
    await requireAuth(request);
    const sources = await prisma.marketplaceSource.findMany({ orderBy: { createdAt: 'desc' } });
    return { sources: sources.map(toSafeSource) };
  });

  app.post('/admin/sources', async (request, reply) => {
    await requireEditor(request);
    const body = sourceCreateSchema.parse(request.body);
    const marketplace = toMarketplaceEnum(body.marketplace);
    if (!marketplace) throw Object.assign(new Error('Marketplace inválido'), { statusCode: 400 });

    const source = await prisma.marketplaceSource.create({
      data: {
        name: body.name,
        marketplace,
        isActive: body.isActive,
        keywords: parseKeywords(body.keywords),
        config: encryptSensitiveConfig(body.config) as any
      }
    });
    return reply.status(201).send({ source: toSafeSource(source) });
  });

  app.put('/admin/sources/:id', async (request) => {
    await requireEditor(request);
    const params = idParamsSchema.parse(request.params);
    const body = sourceUpdateSchema.parse(request.body);
    const marketplace = body.marketplace ? toMarketplaceEnum(body.marketplace) : undefined;
    if (body.marketplace && !marketplace) throw Object.assign(new Error('Marketplace inválido'), { statusCode: 400 });

    const source = await prisma.marketplaceSource.update({
      where: { id: params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(marketplace ? { marketplace } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.keywords !== undefined ? { keywords: parseKeywords(body.keywords) } : {}),
        ...(body.config !== undefined ? { config: encryptSensitiveConfig(body.config) as any } : {})
      }
    });
    return { source: toSafeSource(source) };
  });

  app.delete('/admin/sources/:id', async (request) => {
    await requireEditor(request);
    const params = idParamsSchema.parse(request.params);
    const source = await prisma.marketplaceSource.update({ where: { id: params.id }, data: { isActive: false } });
    return { source: toSafeSource(source) };
  });

  app.get('/alerts', async (request) => {
    await requireAuth(request);
    return { alerts: await prisma.alertRule.findMany({ orderBy: { createdAt: 'desc' } }) };
  });

  app.post('/alerts', async (request, reply) => {
    await requireEditor(request);
    const body = alertCreateSchema.parse(request.body);
    const alert = await prisma.alertRule.create({
      data: {
        name: body.name,
        keywords: parseKeywords(body.keywords),
        marketplaces: parseKeywords(body.marketplaces),
        minDiscountPercent: body.minDiscountPercent,
        maxPrice: body.maxPrice,
        isActive: body.isActive
      }
    });
    return reply.status(201).send({ alert });
  });

  app.put('/alerts/:id', async (request) => {
    await requireEditor(request);
    const params = idParamsSchema.parse(request.params);
    const body = alertUpdateSchema.parse(request.body);
    const alert = await prisma.alertRule.update({
      where: { id: params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.keywords !== undefined ? { keywords: parseKeywords(body.keywords) } : {}),
        ...(body.marketplaces !== undefined ? { marketplaces: parseKeywords(body.marketplaces) } : {}),
        ...(body.minDiscountPercent !== undefined ? { minDiscountPercent: body.minDiscountPercent } : {}),
        ...(body.maxPrice !== undefined ? { maxPrice: body.maxPrice } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {})
      }
    });
    return { alert };
  });

  app.delete('/alerts/:id', async (request) => {
    await requireEditor(request);
    const params = idParamsSchema.parse(request.params);
    const alert = await prisma.alertRule.update({ where: { id: params.id }, data: { isActive: false } });
    return { alert };
  });

  app.get('/dispatch/channels', async (request) => {
    await requireAdmin(request);
    const channels = await prisma.dispatchChannel.findMany({ orderBy: { createdAt: 'desc' } });
    return { channels: channels.map(toSafeChannel) };
  });

  app.post('/dispatch/channels', async (request, reply) => {
    await requireAdmin(request);
    const body = channelCreateSchema.parse(request.body);
    await validateChannelConfig(body.type, body.config);

    const channel = await prisma.dispatchChannel.create({
      data: {
        name: body.name,
        type: body.type,
        config: encryptSensitiveConfig(body.config) as any,
        isActive: body.isActive
      }
    });
    return reply.status(201).send({ channel: toSafeChannel(channel) });
  });

  app.put('/dispatch/channels/:id', async (request) => {
    await requireAdmin(request);
    const params = idParamsSchema.parse(request.params);
    const body = channelUpdateSchema.parse(request.body);
    const existing = await prisma.dispatchChannel.findUnique({ where: { id: params.id } });
    if (!existing) throw Object.assign(new Error('Canal não encontrado'), { statusCode: 404 });

    const nextType = body.type ?? existing.type;
    const nextConfig = body.config ?? decryptSensitiveConfig(existing.config);
    await validateChannelConfig(nextType, nextConfig);

    const channel = await prisma.dispatchChannel.update({
      where: { id: params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.config !== undefined ? { config: encryptSensitiveConfig(body.config) as any } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {})
      }
    });
    return { channel: toSafeChannel(channel) };
  });

  app.delete('/dispatch/channels/:id', async (request) => {
    await requireAdmin(request);
    const params = idParamsSchema.parse(request.params);
    const channel = await prisma.dispatchChannel.update({ where: { id: params.id }, data: { isActive: false } });
    return { channel: toSafeChannel(channel) };
  });

  app.get('/dispatch/logs', async (request) => {
    await requireEditor(request);
    const query = z.object({ limit: optionalNumber }).parse(request.query);
    const logs = await prisma.dispatchLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(query.limit ?? 50, 1), 200),
      include: { offer: { select: { title: true, marketplace: true, currentPrice: true, productUrl: true } } }
    });
    return { logs: logs.map((log) => ({ ...log, offer: log.offer ? { ...log.offer, currentPrice: Number(log.offer.currentPrice) } : null })) };
  });

  app.post('/dispatch/test/:offerId', async (request) => {
    await requireAdmin(request);
    const params = offerIdParamsSchema.parse(request.params);
    const offer = await prisma.offer.findUnique({ where: { id: params.offerId } });
    if (!offer) throw Object.assign(new Error('Oferta não encontrada'), { statusCode: 404 });
    await dispatchOffer({
      id: offer.id,
      title: offer.title,
      currentPrice: Number(offer.currentPrice),
      discountPercent: offer.discountPercent ? Number(offer.discountPercent) : undefined,
      productUrl: offer.productUrl,
      affiliateUrl: offer.affiliateUrl ?? undefined,
      marketplace: String(offer.marketplace).toLowerCase(),
      score: offer.score
    });
    return { status: 'sent' };
  });

  io.on('connection', async (socket) => {
    try {
      socket.emit('offers:init', await listOffers());
      socket.emit('stats:update', await getStats());
    } catch {
      socket.emit('system:error', { message: 'Não foi possível carregar as ofertas iniciais' });
    }
  });

  return app;
}
