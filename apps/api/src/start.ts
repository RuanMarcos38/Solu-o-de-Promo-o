import 'dotenv/config';
import { config } from './config.js';
import { createApp } from './bootstrap.js';
import { prisma } from './db.js';
import { connection } from './queue.js';

const app = await createApp();
await app.listen({ port: config.apiPort, host: '0.0.0.0' });

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
    await prisma.$disconnect();
    if (connection.status !== 'end') await connection.quit();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'graceful shutdown failed');
    process.exit(1);
  }
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
