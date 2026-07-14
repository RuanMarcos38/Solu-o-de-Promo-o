import { after } from 'node:test';

after(async () => {
  const {
    collectOffersQueue,
    connection,
    dispatchDeadLetterQueue,
    dispatchOffersQueue,
    operationalAlertsQueue
  } = await import('../src/queue.js');

  await Promise.allSettled([
    collectOffersQueue.close(),
    dispatchOffersQueue.close(),
    dispatchDeadLetterQueue.close(),
    operationalAlertsQueue.close()
  ]);

  if (connection.status === 'ready') await connection.quit();
  else if (connection.status !== 'end') connection.disconnect();
});