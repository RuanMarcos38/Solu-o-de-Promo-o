import 'dotenv/config';
import { Worker } from 'bullmq';
import { config } from './config.js';
import { runCollection } from './collector.js';
import { getStats } from './offerStore.js';
import { publishCollectionCompleted } from './marketplaceEvents.js';
import { connection, collectOffersQueue, enqueueCollectionJob } from './queue.js';

type CollectJobData = {
  keyword?: string;
  marketplace?: any;
};

const worker = new Worker<CollectJobData>(
  'collect-offers',
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
  { connection, concurrency: 3 }
);

worker.on('completed', (job) => {
  console.log(`[worker] job ${job.id} completed`);
});

worker.on('failed', (job, error) => {
  console.error(`[worker] job ${job?.id} failed`, error);
});

await collectOffersQueue.upsertJobScheduler('recurring-default-collection', {
  every: config.collectIntervalSeconds * 1000
}, {
  name: 'collect',
  data: {}
});

await enqueueCollectionJob({});

console.log('[worker] collection worker running');
