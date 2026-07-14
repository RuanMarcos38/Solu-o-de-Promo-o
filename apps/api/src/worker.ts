import 'dotenv/config';
import { Worker } from 'bullmq';
import { config } from './config.js';
import { runCollection } from './collector.js';
import { prisma } from './db.js';
import { moveDispatchJobToDeadLetter, processDispatchJob } from './dispatch.js';
import { getStats } from './offerStore.js';
import { publishCollectionCompleted } from './marketplaceEvents.js';
import { operationalConfig, validateOperationalAlertConfig } from './operationalConfig.js';
import { processOperationalAlertDelivery } from './operationalAlerts.js';
import {
  COLLECT_QUEUE_NAME,
  DISPATCH_QUEUE_NAME,
  OPERATIONAL_ALERT_QUEUE_NAME,
  connection,
  collectOffersQueue,
  dispatchDeadLetterQueue,
  dispatchOffersQueue,
  enqueueCollectionJob,
  enqueueOperationalAlertMonitorNow,
  operationalAlertsQueue,
  queueConnection,
  scheduleOperationalAlertMonitor,
  type DispatchJobData,
  type OperationalAlertQueueData
} from './queue.js';
import type { MarketplaceName } from './types.js';

type CollectJobData = {
  keyword?: string;
  marketplace?: MarketplaceName;
};

const collectionWorker = new Worker<CollectJobData>(
  COLLECT_QUEUE_NAME,
  async (job) => {
    const result = await runCollection(job.data);
    const stats = await getStats();
    await publishCollectionCompleted({ offers: result.approved, stats });
    return {
      approvedCount: result.approvedCount,
      errorCount: result.errors.length,
      stats
    };
  },
  { connection: queueConnection, concurrency: 3 }
);

const dispatchWorker = new Worker<DispatchJobData>(
  DISPATCH_QUEUE_NAME,
  async (job) => {
    try {
      return await processDispatchJob(job);
    } catch (error) {
      const maxAttempts = Number(job.opts.attempts ?? 1);
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
      if (isFinalAttempt) {
        const normalizedError = error instanceof Error ? error : new Error('Erro desconhecido na distribuição');
        await moveDispatchJobToDeadLetter(job, normalizedError);
      }
      throw error;
    }
  },
  { connection: queueConnection, concurrency: config.dispatchConcurrency }
);

const operationalAlertWorker = new Worker<OperationalAlertQueueData>(
  OPERATIONAL_ALERT_QUEUE_NAME,
  processOperationalAlertDelivery,
  { connection: queueConnection, concurrency: operationalConfig.concurrency }
);

collectionWorker.on('completed', (job) => {
  console.log(`[worker:collect] job ${job.id} completed`);
});

collectionWorker.on('failed', (job, error) => {
  console.error(`[worker:collect] job ${job?.id} failed`, error);
});

dispatchWorker.on('completed', (job, result) => {
  console.log(`[worker:dispatch] job ${job.id} completed`, result);
});

dispatchWorker.on('failed', (job, error) => {
  const maxAttempts = Number(job?.opts.attempts ?? 1);
  const exhausted = Boolean(job && job.attemptsMade >= maxAttempts);
  console.error(`[worker:dispatch] job ${job?.id} failed${exhausted ? ' and was routed to DLQ' : ''}`, error);
});

operationalAlertWorker.on('completed', (job, result) => {
  console.log(`[worker:operational-alert] job ${job.id} completed`, result);
});

operationalAlertWorker.on('failed', (job, error) => {
  console.error(`[worker:operational-alert] job ${job?.id} failed`, error);
});

await collectOffersQueue.add('collect', {}, {
  jobId: 'recurring-default-collection',
  repeat: { every: config.collectIntervalSeconds * 1000 },
  removeOnComplete: 100,
  removeOnFail: 100
});

await enqueueCollectionJob({});

if (operationalConfig.enabled) {
  validateOperationalAlertConfig();
  await scheduleOperationalAlertMonitor();
  await enqueueOperationalAlertMonitorNow();
  console.log(`[worker] operational alerts enabled for ${operationalConfig.channels.join(', ')}`);
}

console.log('[worker] collection, dispatch and operational alert workers running');

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] shutting down after ${signal}`);

  const forceExit = setTimeout(() => {
    console.error('[worker] forced shutdown after timeout');
    process.exit(1);
  }, 20_000);
  forceExit.unref();

  try {
    await Promise.all([
      collectionWorker.close(),
      dispatchWorker.close(),
      operationalAlertWorker.close()
    ]);
    await Promise.all([
      collectOffersQueue.close(),
      dispatchOffersQueue.close(),
      dispatchDeadLetterQueue.close(),
      operationalAlertsQueue.close()
    ]);
    await prisma.$disconnect();
    if (connection.status !== 'end') await connection.quit();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    console.error('[worker] graceful shutdown failed', error);
    process.exit(1);
  }
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));