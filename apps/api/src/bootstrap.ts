import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { UserRole } from '@prisma/client';
import { Server } from 'socket.io';
import { ensureAdminUser, hashPassword, login, requireAdmin, requireAuth, safeUser } from './auth.js';
import { runCollection } from './collector.js';
import { getOfferHistory, getStats, listOffers } from './offerStore.js';
import { dispatchOffer } from './dispatch.js';
import { prisma } from './db.js';
import { connection, enqueueCollectionJob } from './queue.js';
import { emitNewOffers, emitStats, setRealtimeServer } from './realtime.js';
import { registerMarketplaceEventBridge } from './marketplaceEvents.js';
import { toMarketplaceEnum, toMarketplaceName } from './marketplace.js';
import { ensureDefaultSources } from './sources.js';

function asNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseQuery(query: any) {
  return {
    keyword: query.keyword,
    marketplace: query.marketplace,
    category: query.category,
    minDiscount: asNumber(query.minDiscount),
    maxPrice: asNumber(query.maxPrice),
    minScore: asNumber(query.minScore),
    limit: asNumber(query.limit)
  };
}

function parseKeywords(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function parseUserRole(value: unknown) {
  const role = String(value ?? 'VIEWER').toUpperCase();
  if (role === 'ADMIN') return UserRole.ADMIN;
  if (role === 'EDITOR') return UserRole.EDITOR;
  return UserRole.VIEWER;
}

export async function createApp() {
  const app = Fastify({ logger: true });
  const io = new Server(app.server, { cors: { origin: true } });
  setRealtimeServer(io);
  await registerMarketplaceEventBridge(io);
  await ensureAdminUser();
  await ensureDefaultSources();

  await app.register(cors, { origin: true });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.get('/health', async () => ({ status: 'ok', service: 'promotion-radar-api' }));

  app.get('/ready', async (request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await connection.ping();
      return { status: 'ready', database: 'ok', redis: 'ok' };
    } catch (error) {
      return reply.status(503).send({
        status: 'not_ready',
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }
  });

  app.post('/auth/login', async (request, reply) => {
    const body = request.body as any;
    const result = await login(String(body?.email ?? ''), String(body?.password ?? ''));
    if (!result) return reply.status(401).send({ message: 'E-mail ou senha inválidos' });
    return result;
  });

  app.get('/auth/me', async (request) => ({ user: requireAuth(request) }));

  app.get('/offers', async (request) => ({ offers: await listOffers(parseQuery(request.query)) }));
  app.get('/offers/stats', async () => getStats());
  app.get('/offers/:id/history', async (request) => {
    const params = request.params as any;
    return { history: await getOfferHistory(params.id) };
  });

  app.post('/collect/run', async (request) => {
    requireAuth(request);
    const result = await runCollection(request.body as any);
    emitNewOffers(result.approved);
    emitStats(await getStats());
    return result;
  });

  app.post('/collect/enqueue', async (request) => {
    requireAuth(request);
    const body = request.body as any;
    const job = await enqueueCollectionJob({ keyword: body?.keyword, marketplace: toMarketplaceName(body?.marketplace) });
    return { status: 'queued', jobId: job.id };
  });

  app.get('/admin/users', async (request) => {
    requireAdmin(request);
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
    return { users: users.map(safeUser) };
  });

  app.post('/admin/users', async (request) => {
    requireAdmin(request);
    const body = request.body as any;
    const password = String(body.password ?? '').trim();
    if (password.length < 8) throw Object.assign(new Error('Senha precisa ter pelo menos 8 caracteres'), { statusCode: 400 });

    const user = await prisma.user.create({
      data: {
        name: String(body.name ?? '').trim(),
        email: String(body.email ?? '').trim().toLowerCase(),
        passwordHash: await hashPassword(password),
        role: parseUserRole(body.role),
        isActive: body.isActive ?? true
      }
    });
    return { user: safeUser(user) };
  });

  app.put('/admin/users/:id', async (request) => {
    requireAdmin(request);
    const params = request.params as any;
    const body = request.body as any;
    const user = await prisma.user.update({
      where: { id: params.id },
      data: {
        ...(body.name !== undefined ? { name: String(body.name) } : {}),
        ...(body.email !== undefined ? { email: String(body.email).toLowerCase() } : {}),
        ...(body.role !== undefined ? { role: parseUserRole(body.role) } : {}),
        ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
        ...(body.password !== undefined && String(body.password).length >= 8 ? { passwordHash: await hashPassword(String(body.password)) } : {})
      }
    });
    return { user: safeUser(user) };
  });

  app.get('/admin/sources', async (request) => {
    requireAuth(request);
    return { sources: await prisma.marketplaceSource.findMany({ orderBy: { createdAt: 'desc' } }) };
  });

  app.post('/admin/sources', async (request) => {
    requireAdmin(request);
    const body = request.body as any;
    const marketplace = toMarketplaceEnum(body?.marketplace);
    if (!marketplace) throw Object.assign(new Error('Marketplace inválido'), { statusCode: 400 });
    const source = await prisma.marketplaceSource.create({
      data: {
        name: String(body.name ?? `${marketplace} source`),
        marketplace,
        isActive: body.isActive ?? true,
        keywords: parseKeywords(body.keywords),
        config: body.config ?? {}
      }
    });
    return { source };
  });

  app.put('/admin/sources/:id', async (request) => {
    requireAdmin(request);
    const params = request.params as any;
    const body = request.body as any;
    const marketplace = body.marketplace ? toMarketplaceEnum(body.marketplace) : undefined;
    const source = await prisma.marketplaceSource.update({
      where: { id: params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(marketplace ? { marketplace } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.keywords !== undefined ? { keywords: parseKeywords(body.keywords) } : {}),
        ...(body.config !== undefined ? { config: body.config } : {})
      }
    });
    return { source };
  });

  app.delete('/admin/sources/:id', async (request) => {
    requireAdmin(request);
    const params = request.params as any;
    const source = await prisma.marketplaceSource.update({ where: { id: params.id }, data: { isActive: false } });
    return { source };
  });

  app.get('/alerts', async (request) => {
    requireAuth(request);
    return { alerts: await prisma.alertRule.findMany({ orderBy: { createdAt: 'desc' } }) };
  });

  app.post('/alerts', async (request) => {
    requireAuth(request);
    const body = request.body as any;
    const alert = await prisma.alertRule.create({
      data: {
        name: String(body.name ?? 'Alerta'),
        keywords: parseKeywords(body.keywords),
        marketplaces: parseKeywords(body.marketplaces),
        minDiscountPercent: Number(body.minDiscountPercent ?? 10),
        maxPrice: body.maxPrice ?? null,
        isActive: body.isActive ?? true
      }
    });
    return { alert };
  });

  app.put('/alerts/:id', async (request) => {
    requireAuth(request);
    const params = request.params as any;
    const body = request.body as any;
    const alert = await prisma.alertRule.update({
      where: { id: params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.keywords !== undefined ? { keywords: parseKeywords(body.keywords) } : {}),
        ...(body.marketplaces !== undefined ? { marketplaces: parseKeywords(body.marketplaces) } : {}),
        ...(body.minDiscountPercent !== undefined ? { minDiscountPercent: Number(body.minDiscountPercent) } : {}),
        ...(body.maxPrice !== undefined ? { maxPrice: body.maxPrice } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {})
      }
    });
    return { alert };
  });

  app.delete('/alerts/:id', async (request) => {
    requireAuth(request);
    const params = request.params as any;
    const alert = await prisma.alertRule.update({ where: { id: params.id }, data: { isActive: false } });
    return { alert };
  });

  app.get('/dispatch/channels', async (request) => {
    requireAuth(request);
    return { channels: await prisma.dispatchChannel.findMany({ orderBy: { createdAt: 'desc' } }) };
  });

  app.post('/dispatch/channels', async (request) => {
    requireAdmin(request);
    const body = request.body as any;
    const channel = await prisma.dispatchChannel.create({
      data: { name: String(body.name ?? 'Canal'), type: String(body.type ?? 'webhook'), config: body.config ?? {}, isActive: body.isActive ?? true }
    });
    return { channel };
  });

  app.put('/dispatch/channels/:id', async (request) => {
    requireAdmin(request);
    const params = request.params as any;
    const body = request.body as any;
    const channel = await prisma.dispatchChannel.update({
      where: { id: params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.config !== undefined ? { config: body.config } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {})
      }
    });
    return { channel };
  });

  app.delete('/dispatch/channels/:id', async (request) => {
    requireAdmin(request);
    const params = request.params as any;
    const channel = await prisma.dispatchChannel.update({ where: { id: params.id }, data: { isActive: false } });
    return { channel };
  });

  app.get('/dispatch/logs', async (request) => {
    requireAuth(request);
    const query = request.query as any;
    const logs = await prisma.dispatchLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Number(query.limit ?? 50), 1), 200),
      include: { offer: { select: { title: true, marketplace: true, currentPrice: true, productUrl: true } } }
    });
    return { logs: logs.map((log) => ({ ...log, offer: log.offer ? { ...log.offer, currentPrice: Number(log.offer.currentPrice) } : null })) };
  });

  app.post('/dispatch/test/:offerId', async (request) => {
    requireAdmin(request);
    const params = request.params as any;
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
    socket.emit('offers:init', await listOffers());
    socket.emit('stats:update', await getStats());
  });

  return app;
}
