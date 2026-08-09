import { createHash } from 'node:crypto';
import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';
import { operationalConfig, type OperationalAlertChannel } from './operationalConfig.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const parsedRedisUrl = new URL(redisUrl);
const database = Number(parsedRedisUrl.pathname.replace(/^\//, '') || '0');
// Queue clients must not make API startup depend on Redis. The worker and queue
// endpoints connect on first use, while /ready still reports Redis availability.
const lazyConnect = true;

export const queueConnection: ConnectionOptions = {
  host: parsedRedisUrl.hostname,
  port: Number(parsedRedisUrl.port || '6379'),
  ...(parsedRedisUrl.username ? { username: decodeURIComponent(parsedRedisUrl.username) } : {}),
  ...(parsedRedisUrl.password ? { password: decodeURIComponent(parsedRedisUrl.password) } : {}),
  db: Number.isInteger(database) ? database : 0,
  maxRetriesPerRequest: null,
  lazyConnect,
  ...(parsedRedisUrl.protocol === 'rediss:' ? { tls: {} } : {})
};

export const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  lazyConnect
});

connection.on('error', (error) => {
  if (process.env.NODE_ENV !== 'test') {
    console.warn('[redis] connection unavailable', {
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export const COLLECT_QUEUE_NAME = 'collect-offers';
export const DISPATCH_QUEUE_NAME = 'dispatch-offers';
export const DISPATCH_DLQ_NAME = 'dispatch-dead-letter';
export const OPERATIONAL_ALERT_QUEUE_NAME = 'operational-alerts';

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

export type OperationalAlert = {
  kind: 'dlq-item' | 'dlq-threshold' | 'dlq-recovery' | 'test';
  severity: 'info' | 'warning' | 'critical' | 'recovery';
  title: string;
  message: string;
  deduplicationKey: string;
  occurredAt: string;
  details: Record<string, unknown>;
};

export type OperationalAlertQueueData =
  | { type: 'delivery'; channel: OperationalAlertChannel; alert: OperationalAlert }
  | { type: 'monitor' };

function createLazyQueue<T>(factory: () => Queue<T>) {
  let instance: Queue<T> | null = null;

  return new Proxy({} as Queue<T>, {
    get(_target, property) {
      if (property === 'close') {
        return async () => {
          if (!instance) return;
          const queue = instance;
          instance = null;
          await queue.close();
        };
      }

      instance ??= factory();
      const value = Reflect.get(instance, property, instance);
      return typeof value === 'function' ? value.bind(instance) : value;
    }
  });
}

export const collectOffersQueue = createLazyQueue(() => new Queue(COLLECT_QUEUE_NAME, {
  connection: queueConnection
}));

export const dispatchOffersQueue = createLazyQueue(() => new Queue<DispatchJobData>(DISPATCH_QUEUE_NAME, {
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
}));

export const dispatchDeadLetterQueue = createLazyQueue(() => new Queue<DispatchDeadLetterData>(DISPATCH_DLQ_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    removeOnComplete: false,
    removeOnFail: false
  }
}));

let operationalAlertsQueueInstance: Queue<OperationalAlertQueueData> | null = null;

function getOperationalAlertsQueue() {
  if (!operationalAlertsQueueInstance) {
    operationalAlertsQueueInstance = new Queue<OperationalAlertQueueData>(OPERATIONAL_ALERT_QUEUE_NAME, {
      connection: queueConnection,
      defaultJobOptions: {
        attempts: operationalConfig.attempts,
        backoff: { type: 'exponential', delay: operationalConfig.backoffMs },
        removeOnComplete: { age: 604_800, count: 5_000 },
        removeOnFail: { age: 1_209_600, count: 5_000 }
      }
    });
  }
  return operationalAlertsQueueInstance;
}

export const operationalAlertsQueue = new Proxy({} as Queue<OperationalAlertQueueData>, {
  get(_target, property) {
    if (property === 'close') {
      return async () => {
        if (!operationalAlertsQueueInstance) return;
        const queue = operationalAlertsQueueInstance;
        operationalAlertsQueueInstance = null;
        await queue.close();
      };
    }

    const queue = getOperationalAlertsQueue();
    const value = Reflect.get(queue, property, queue);
    return typeof value === 'function' ? value.bind(queue) : value;
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
  const job = await dispatchDeadLetterQueue.add('dead-letter', data, { jobId });
  if (operationalConfig.enabled) {
    try {
      const { queueDeadLetterOperationalAlert } = await import('./operationalAlerts.js');
      await queueDeadLetterOperationalAlert(data, String(job.id));
    } catch (error) {
      console.error('[operational-alerts] failed to queue DLQ notification', error);
    }
  }
  return job;
}

export async function enqueueOperationalAlert(alert: OperationalAlert) {
  const results: Array<{ channel: OperationalAlertChannel; jobId: string; created: boolean }> = [];
  for (const channel of operationalConfig.channels) {
    const digest = createHash('sha256').update(`${alert.deduplicationKey}:${channel}`).digest('hex');
    const jobId = `operational-alert-${digest}`;
    const existing = await operationalAlertsQueue.getJob(jobId);
    if (existing) {
      results.push({ channel, jobId, created: false });
      continue;
    }
    const job = await operationalAlertsQueue.add('deliver', { type: 'delivery', channel, alert }, { jobId });
    results.push({ channel, jobId: String(job.id), created: true });
  }
  return results;
}

export async function scheduleOperationalAlertMonitor() {
  return operationalAlertsQueue.add('monitor-dlq', { type: 'monitor' }, {
    jobId: 'operational-dlq-monitor',
    repeat: { every: operationalConfig.checkIntervalSeconds * 1000 },
    removeOnComplete: 100,
    removeOnFail: 100
  });
}

export async function enqueueOperationalAlertMonitorNow() {
  return operationalAlertsQueue.add('monitor-dlq', { type: 'monitor' }, {
    jobId: `operational-dlq-monitor-${Date.now()}`,
    removeOnComplete: 10,
    removeOnFail: 10
  });
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