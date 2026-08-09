import { Server } from 'socket.io';
import { connection } from './queue.js';

const CHANNEL = 'promotion-events';
const STARTUP_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.REDIS_STARTUP_TIMEOUT_MS || 5_000)
);

type PromotionEvent = {
  type: 'collection.completed';
  offers: unknown[];
  stats: unknown;
};

export async function publishCollectionCompleted(event: Omit<PromotionEvent, 'type'>) {
  await connection.publish(CHANNEL, JSON.stringify({ type: 'collection.completed', ...event }));
}

export async function registerMarketplaceEventBridge(io: Server) {
  const subscriber = connection.duplicate({
    connectTimeout: STARTUP_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null
  });

  subscriber.on('error', (error) => {
    console.warn('[redis] event subscriber unavailable', {
      message: error instanceof Error ? error.message : String(error)
    });
  });

  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      subscriber.subscribe(CHANNEL),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Redis subscriber indisponível após ${STARTUP_TIMEOUT_MS}ms`)),
          STARTUP_TIMEOUT_MS
        );
        timeout.unref();
      })
    ]);
  } catch (error) {
    subscriber.disconnect();
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  subscriber.on('message', (_channel: string, message: string) => {
    try {
      const event = JSON.parse(message) as PromotionEvent;
      if (event.type !== 'collection.completed') return;
      for (const offer of event.offers) io.emit('offer:new', offer);
      io.emit('stats:update', event.stats);
    } catch (error) {
      console.error('[events] invalid promotion event', error);
    }
  });

  return subscriber;
}
