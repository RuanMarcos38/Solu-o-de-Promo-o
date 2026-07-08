import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { ensureAdminUser, login, requireAdmin, requireAuth } from './auth.js';
import { runCollection } from './collector.js';
import { getOfferHistory, getStats, listOffers } from './offerStore.js';
import { dispatchOffer } from './dispatch.js';
import { prisma } from './db.js';
import { enqueueCollectionJob } from './queue.js';
import { emitNewOffers, emitStats, setRealtimeServer } from './realtime.js';
import { registerMarketplaceEventBridge } from './marketplaceEvents.js';
import { toMarketplaceEnum, toMarketplaceName } from './marketplace.js';

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

export async function createApp() {
  const app = Fastify({ logger: true });
  const io = new Server(app.server, { cors: { origin: true } });
  setRealtimeServer(io);
  await registerMarketplaceEventBridge(io);
  await ensureAdminUser();

  await app.register(cors, { origin: true });

  app.get('/health', async () => ({ status: 'ok', service: 'promotion-radar-api' }));

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
        name: body.name,
        marketplace,
        isActive: body.isActive ?? true,
        keywords: body.keywords ?? [],
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
        ...(body.keywords !== undefined ? { keywords: body.keywords } : {}),
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
        name: body.name,
        keywords: body.keywords ?? [],
        marketplaces: body.marketplaces ?? [],
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
    const alert = await prisma.alertRule.update({ where: { id: params.id }, data: body });
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
      data: { name: body.name, type: body.type, config: body.config ?? {}, isActive: body.isActive ?? true }
    });
    return { channel };
  });

  app.put('/dispatch/channels/:id', async (request) => {
    requireAdmin(request);
    const params = request.params as any;
    const body = request.body as any;
    const channel = await prisma.dispatchChannel.update({ where: { id: params.id }, data: body });
    return { channel };
  });

  app.delete('/dispatch/channels/:id', async (request) => {
    requireAdmin(request);
    const params = request.params as any;
    const channel = await prisma.dispatchChannel.update({ where: { id: params.id }, data: { isActive: false } });
    return { channel };
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
