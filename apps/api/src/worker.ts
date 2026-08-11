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
  configureCollectionSchedule,
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
import { getPlatformSettings } from './runtimeSettings.js';
import {
  closeMetricsServer,
  initializeOpenTelemetry,
  observeQueueJob,
  recordDispatchAttempt,
  recordOperationalAlertDelivery,
  refreshQueueMetrics,
  shutdownOpenTelemetry,
  startWorkerMetricsServer
} from './telemetry.js';
import type { MarketplaceName } from './types.js';

type CollectJobData = {
  keyword?: string;
  marketplace?: MarketplaceName;
};

await initializeOpenTelemetry('worker');

const collectionWorker = new Worker<CollectJobData>(
  COLLECT_QUEUE_NAME,
  async (job) => observeQueueJob(COLLECT_QUEUE_NAME, job, async () => {
    const result = await runCollection(job.data);
    const stats = await getStats();
    await publishCollectionCompleted({ offers: result.approved, stats });
    return {
      approvedCount: result.approvedCount,
      errorCount: result.errors.length,
      stats
    };
  }),
  { connection: queueConnection, concurrency: 3 }
);

const dispatchWorker = new Worker<DispatchJobData>(
  DISPATCH_QUEUE_NAME,
  async (job) => observeQueueJob(DISPATCH_QUEUE_NAME, job, async () => {
    const channel = await prisma.dispatchChannel.findUnique({
      where: { id: job.data.channelId },
      select: { type: true }
    });
    const channelType = channel?.type || 'unknown';
    try {
      const result = await processDispatchJob(job);
      recordDispatchAttempt(channelType, result.status === 'sent' || result.status === 'already-sent');
      return result;
    } catch (error) {
      recordDispatchAttempt(channelType, false);
      const maxAttempts = Number(job.opts.attempts ?? 1);
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
      if (isFinalAttempt) {
        const normalizedError = error instanceof Error ? error : new Error('Erro desconhecido na distribuição');
        await moveDispatchJobToDeadLetter(job, normalizedError);
      }
      throw error;
    }
  }),
  { connection: queueConnection, concurrency: config.dispatchConcurrency }
);

const operationalAlertWorker = new Worker<OperationalAlertQueueData>(
  OPERATIONAL_ALERT_QUEUE_NAME,
  async (job) => observeQueueJob(OPERATIONAL_ALERT_QUEUE_NAME, job, async () => {
    try {
      const result = await processOperationalAlertDelivery(job);
      if (job.data.type === 'delivery') {
        recordOperationalAlertDelivery(job.data.channel, job.data.alert.kind, true);
      }
      return result;
    } catch (error) {
      if (job.data.type === 'delivery') {
        recordOperationalAlertDelivery(job.data.channel, job.data.alert.kind, false);
      }
      throw error;
    }
  }),
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

const workerMetricsServer = await startWorkerMetricsServer(async () => {
  await refreshQueueMetrics({
    'collect-offers': collectOffersQueue,
    'dispatch-offers': dispatchOffersQueue,
    'dispatch-dead-letter': dispatchDeadLetterQueue,
    'operational-alerts': operationalAlertsQueue
  });
});

const runtimeSettings = await getPlatformSettings();
await configureCollectionSchedule({
  enabled: runtimeSettings.settings.collection.automaticEnabled,
  intervalSeconds: runtimeSettings.settings.collection.intervalSeconds
});

if (runtimeSettings.settings.collection.automaticEnabled) await enqueueCollectionJob({});

if (operationalConfig.enabled) {
  validateOperationalAlertConfig();
  await scheduleOperationalAlertMonitor();
  await enqueueOperationalAlertMonitorNow();
  console.log(`[worker] operational alerts enabled for ${operationalConfig.channels.join(', ')}`);
}

console.log('[worker] collection, dispatch, operational alert and observability services running');

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
    await closeMetricsServer(workerMetricsServer);
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
    await shutdownOpenTelemetry();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    console.error('[worker] graceful shutdown failed', error);
    process.exit(1);
  }
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
