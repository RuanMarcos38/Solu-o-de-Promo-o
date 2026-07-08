import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { runCollection } from './collector.js';
import { getStats, listOffers } from './offerStore.js';
import { enqueueCollectionJob } from './queue.js';
import { emitNewOffers, emitStats, setRealtimeServer } from './realtime.js';
import { registerMarketplaceEventBridge } from './marketplaceEvents.js';

export async function createApp() {
  const app = Fastify({ logger: true });
  const io = new Server(app.server, { cors: { origin: true } });
  setRealtimeServer(io);
  await registerMarketplaceEventBridge(io);

  await app.register(cors, { origin: true });

  app.get('/health', async () => ({ status: 'ok', service: 'promotion-radar-api' }));
  app.get('/offers', async () => ({ offers: await listOffers() }));
  app.get('/offers/stats', async () => getStats());

  app.post('/collect/run', async (request) => {
    const result = await runCollection(request.body as any);
    emitNewOffers(result.approved);
    emitStats(await getStats());
    return result;
  });

  app.post('/collect/enqueue', async (request) => {
    const job = await enqueueCollectionJob(request.body as any);
    return { status: 'queued', jobId: job.id };
  });

  io.on('connection', async (socket) => {
    socket.emit('offers:init', await listOffers());
    socket.emit('stats:update', await getStats());
  });

  return app;
}
