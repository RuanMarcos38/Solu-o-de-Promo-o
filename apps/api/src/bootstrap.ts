import Fastify from 'fastify';
import cors from '@fastify/cors';
import { runCollection } from './collector.js';
import { getStats, listOffers } from './offerStore.js';

export async function createApp() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  app.get('/health', async () => ({ status: 'ok', service: 'promotion-radar-api' }));
  app.get('/offers', async () => ({ offers: listOffers() }));
  app.get('/offers/stats', async () => getStats());
  app.post('/collect/run', async (request) => runCollection(request.body as any));
  return app;
}
