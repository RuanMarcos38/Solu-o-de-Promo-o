import { Server } from 'socket.io';
import { connection } from './queue.js';

const CHANNEL = 'promotion-events';

type PromotionEvent = {
  type: 'collection.completed';
  offers: unknown[];
  stats: unknown;
};

export async function publishCollectionCompleted(event: Omit<PromotionEvent, 'type'>) {
  await connection.publish(CHANNEL, JSON.stringify({ type: 'collection.completed', ...event }));
}

export async function registerMarketplaceEventBridge(io: Server) {
  const subscriber = connection.duplicate();
  await subscriber.subscribe(CHANNEL);

  subscriber.on('message', (_channel, message) => {
    try {
      const event = JSON.parse(message) as PromotionEvent;
      if (event.type !== 'collection.completed') return;
      for (const offer of event.offers) io.emit('offer:new', offer);
      io.emit('stats:update', event.stats);
    } catch (error) {
      console.error('[events] invalid promotion event', error);
    }
  });
}
