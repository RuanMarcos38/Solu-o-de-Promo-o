import 'dotenv/config';
import { config } from './config.js';
import { prisma } from './db.js';
import {
  collectOffersQueue,
  connection,
  dispatchDeadLetterQueue,
  dispatchOffersQueue,
  operationalAlertsQueue,
  redisConfigurationIssue
} from './queue.js';
import { initializeOpenTelemetry, shutdownOpenTelemetry } from './telemetry.js';

await initializeOpenTelemetry('api');
const { createApp } = await import('./application.js');
const app = await createApp({ waitForDependencies: false });
await app.listen({ port: config.apiPort, host: config.apiHost });

for (const warning of config.configurationWarnings) {
  app.log.warn({ code: warning.code }, warning.message);
}
if (redisConfigurationIssue) app.log.warn({ code: 'REDIS_URL_INVALID' }, redisConfigurationIssue);

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down API');

  const forceExit = setTimeout(() => {
    app.log.error('forced shutdown after timeout');
    process.exit(1);
  }, 15_000);
  forceExit.unref();

  try {
    await app.close();
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
    app.log.error({ err: error }, 'graceful shutdown failed');
    process.exit(1);
  }
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
