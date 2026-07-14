import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';

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

export const COLLECT_QUEUE_NAME = 'collect-offers';
export const DISPATCH_QUEUE_NAME = 'dispatch-offers';
export const DISPATCH_DLQ_NAME = 'dispatch-dead-letter';

export type DispatchJobData = {
  offerId: string;
  channelId: string;
  idempotencyKey: string;
  matchedAlertNames: string[];
  enqueuedAt: string;
  replayOf?: string;
};

export type DispatchDeadLetterData = DispatchJobData & {
  originalJobId: string;
  failedAt: string;
  failedReason: string;
  attemptsMade: number;
};

export const collectOffersQueue = new Queue(COLLECT_QUEUE_NAME, {
  connection: queueConnection
});

export const dispatchOffersQueue = new Queue<DispatchJobData>(DISPATCH_QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: config.dispatchAttempts,
    backoff: { type: 'exponential', delay: config.dispatchBackoffMs },
    removeOnComplete: {
      age: config.dispatchCompletedRetentionSeconds,
      count: config.dispatchRetentionCount
    },
    removeOnFail: {
      age: config.dispatchFailedRetentionSeconds,
      count: config.dispatchRetentionCount
    }
  }
});

export const dispatchDeadLetterQueue = new Queue<DispatchDeadLetterData>(DISPATCH_DLQ_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    removeOnComplete: false,
    removeOnFail: false
  }
});

export async function enqueueCollectionJob(data: { keyword?: string; marketplace?: string }) {
  return collectOffersQueue.add('collect', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 100
  });
}

export async function enqueueDispatchJob(
  data: DispatchJobData,
  options: { replayNonce?: string } = {}
) {
  const suffix = options.replayNonce ? `-retry-${options.replayNonce}` : '';
  const jobId = `dispatch-${data.idempotencyKey}${suffix}`;
  const existing = await dispatchOffersQueue.getJob(jobId);
  if (existing) return { job: existing, created: false };

  const job = await dispatchOffersQueue.add('deliver', data, { jobId });
  return { job, created: true };
}

export async function enqueueDeadLetterJob(data: DispatchDeadLetterData) {
  const jobId = `dlq-${data.originalJobId}`;
  const existing = await dispatchDeadLetterQueue.getJob(jobId);
  if (existing) return existing;
  return dispatchDeadLetterQueue.add('dead-letter', data, { jobId });
}

export async function retryDeadLetterJob(deadLetterJobId: string) {
  const deadLetterJob = await dispatchDeadLetterQueue.getJob(deadLetterJobId);
  if (!deadLetterJob) return null;

  const { originalJobId: _originalJobId, failedAt: _failedAt, failedReason: _failedReason, attemptsMade: _attemptsMade, ...dispatchData } = deadLetterJob.data;
  const replayNonce = Date.now().toString(36);
  const result = await enqueueDispatchJob(
    { ...dispatchData, replayOf: deadLetterJob.id ?? deadLetterJobId, enqueuedAt: new Date().toISOString() },
    { replayNonce }
  );

  await deadLetterJob.remove();
  return result.job;
}

export function dispatchJobOptions(): JobsOptions {
  return {
    attempts: config.dispatchAttempts,
    backoff: { type: 'exponential', delay: config.dispatchBackoffMs }
  };
}
