import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { runCollection } from './collector.js';
import { getStats, listOffers } from './offerStore.js';

export async function createApp() {
  const app = Fastify({ logger: true });
  const io = new Server(app.server, { cors: { origin: true } });

  await app.register(cors, { origin: true });

  app.decorate('io', io);

  app.get('/health', async () => ({ status: 'ok', service: 'promotion-radar-api' }));
  app.get('/offers', async () => ({ offers: await listOffers() }));
  app.get('/offers/stats', async () => getStats());
  app.post('/collect/run', async (request) => {
    const result = await runCollection(request.body as any);
    for (const offer of result.approved) io.emit('offer:new', offer);
    io.emit('stats:update', await getStats());
    return result;
  });

  io.on('connection', async (socket) => {
    socket.emit('offers:init', await listOffers());
    socket.emit('stats:update', await getStats());
  });

  return app;
}
