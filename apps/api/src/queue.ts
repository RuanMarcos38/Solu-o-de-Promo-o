import { Queue } from 'bullmq';
import Redis from 'ioredis';

export const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

export const collectOffersQueue = new Queue('collect-offers', { connection });

export async function enqueueCollectionJob(data: { keyword?: string; marketplace?: string }) {
  return collectOffersQueue.add('collect', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 100
  });
}
