import 'dotenv/config';
import { connection, dispatchDeadLetterQueue, dispatchOffersQueue, retryDeadLetterJob } from './queue.js';

async function closeConnections() {
  await Promise.all([
    dispatchDeadLetterQueue.close(),
    dispatchOffersQueue.close()
  ]);
  if (connection.status !== 'end') await connection.quit();
}

async function main() {
  const deadLetterJobId = process.argv[2];

  if (!deadLetterJobId) {
    const jobs = await dispatchDeadLetterQueue.getJobs(['waiting', 'delayed', 'failed', 'completed'], 0, 49, true);
    if (jobs.length === 0) {
      console.log('[dispatch:dlq] nenhum job aguardando reprocessamento');
      return;
    }

    console.table(jobs.map((job) => ({
      jobId: job.id,
      offerId: job.data.offerId,
      channelId: job.data.channelId,
      attemptsMade: job.data.attemptsMade,
      failedAt: job.data.failedAt,
      reason: job.data.failedReason
    })));
    console.log('\nUse: npm run retry:dlq -w apps/api -- <jobId>');
    return;
  }

  const retried = await retryDeadLetterJob(deadLetterJobId);
  if (!retried) {
    process.exitCode = 1;
    console.error(`[dispatch:dlq] job ${deadLetterJobId} não encontrado`);
    return;
  }

  console.log(`[dispatch:dlq] job ${deadLetterJobId} reenfileirado como ${retried.id}`);
}

main()
  .catch((error) => {
    process.exitCode = 1;
    console.error('[dispatch:dlq] falha ao operar a dead-letter queue', error);
  })
  .finally(closeConnections);
