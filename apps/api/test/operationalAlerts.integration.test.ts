import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/application.js';
import { prisma } from '../src/db.js';
import { monitorDlqThreshold } from '../src/operationalAlerts.js';
import { operationalConfig } from '../src/operationalConfig.js';
import {
  collectOffersQueue,
  connection,
  dispatchDeadLetterQueue,
  dispatchOffersQueue,
  enqueueDeadLetterJob,
  operationalAlertsQueue
} from '../src/queue.js';

let app: FastifyInstance;
let adminToken = '';
let deadLetterJobId = '';

async function alertJobs() {
  return operationalAlertsQueue.getJobs(['waiting', 'delayed', 'completed', 'failed'], 0, 100, false);
}

before(async () => {
  operationalConfig.enabled = true;
  operationalConfig.channels = ['webhook'];
  operationalConfig.webhookUrl = 'https://alerts.example.com/radar';
  operationalConfig.dlqThreshold = 1;
  operationalConfig.cooldownSeconds = 60;

  await dispatchOffersQueue.obliterate({ force: true });
  await dispatchDeadLetterQueue.obliterate({ force: true });
  await operationalAlertsQueue.obliterate({ force: true });
  await connection.del(
    'operational-alerts:dlq:state',
    'operational-alerts:dlq:incident',
    'operational-alerts:dlq:reminder',
    'operational-alerts:dlq:monitor-lock'
  );
  await prisma.user.deleteMany();
  app = await createApp();

  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }
  });
  assert.equal(response.statusCode, 200, response.body);
  adminToken = (response.json() as { token: string }).token;
});

after(async () => {
  if (app) await app.close();
  await Promise.all([
    collectOffersQueue.close(),
    dispatchOffersQueue.close(),
    dispatchDeadLetterQueue.close(),
    operationalAlertsQueue.close()
  ]);
  if (connection.status !== 'end') await connection.quit();
  await prisma.$disconnect();
});

describe('alertas operacionais integrados', () => {
  test('protege endpoints e enfileira alerta de teste sem expor configuração', async () => {
    const denied = await app.inject({ method: 'GET', url: '/admin/operational-alerts/status' });
    assert.equal(denied.statusCode, 401);

    const status = await app.inject({
      method: 'GET',
      url: '/admin/operational-alerts/status',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(status.statusCode, 200, status.body);
    assert.equal(status.body.includes('alerts.example.com'), false);

    const queued = await app.inject({
      method: 'POST',
      url: '/admin/operational-alerts/test',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(queued.statusCode, 202, queued.body);
    const body = queued.json() as { channels: Array<{ channel: string; jobId: string }> };
    assert.equal(body.channels[0].channel, 'webhook');
    assert.ok(await operationalAlertsQueue.getJob(body.channels[0].jobId));
  });

  test('deduplica entrada na DLQ por canal', async () => {
    const data = {
      offerId: 'offer-alert',
      channelId: 'channel-alert',
      idempotencyKey: 'alert-key',
      matchedAlertNames: ['Notebook'],
      enqueuedAt: new Date().toISOString(),
      originalJobId: 'dispatch-alert-key',
      failedAt: new Date().toISOString(),
      failedReason: 'Provider unavailable',
      attemptsMade: 5
    };
    const first = await enqueueDeadLetterJob(data);
    await enqueueDeadLetterJob(data);
    deadLetterJobId = String(first.id);
    const itemAlerts = (await alertJobs()).filter((job) => job.data.type === 'delivery' && job.data.alert.kind === 'dlq-item');
    assert.equal(itemAlerts.length, 1);
  });

  test('entra em estado crítico, respeita cooldown e envia recuperação', async () => {
    assert.equal((await monitorDlqThreshold()).status, 'critical-entered');
    assert.equal((await monitorDlqThreshold()).status, 'critical');
    const criticalAlerts = (await alertJobs()).filter((job) => job.data.type === 'delivery' && job.data.alert.kind === 'dlq-threshold');
    assert.equal(criticalAlerts.length, 1);

    const deadLetter = await dispatchDeadLetterQueue.getJob(deadLetterJobId);
    assert.ok(deadLetter);
    await deadLetter.remove();
    assert.equal((await monitorDlqThreshold()).status, 'recovered');
    const recoveryAlerts = (await alertJobs()).filter((job) => job.data.type === 'delivery' && job.data.alert.kind === 'dlq-recovery');
    assert.equal(recoveryAlerts.length, 1);
  });
});