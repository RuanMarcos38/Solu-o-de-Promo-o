import { Queue, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const parsedRedisUrl = new URL(redisUrl);
const database = Number(parsedRedisUrl.pathname.replace(/^\//, '') || '0');

export const queueConnection: ConnectionOptions = {
  host: parsedRedisUrl.hostname,
  port: Number(parsedRedisUrl.port || '6379'),
  ...(parsedRedisUrl.username ? { username: decodeURIComponent(parsedRedisUrl.username) } : {}),
  ...(parsedRedisUrl.password ? { password: decodeURIComponent(parsedRedisUrl.password) } : {}),
  db: Number.isInteger(database) ? database : 0,
  maxRetriesPerRequest: null,
  ...(parsedRedisUrl.protocol === 'rediss:' ? { tls: {} } : {})
};

export const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null
});

export const collectOffersQueue = new Queue('collect-offers', {
  connection: queueConnection
});

export async function enqueueCollectionJob(data: { keyword?: string; marketplace?: string }) {
  return collectOffersQueue.add('collect', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 100
  });
}
