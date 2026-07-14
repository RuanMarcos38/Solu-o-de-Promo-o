import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Marketplace, UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/application.js';
import { hashPassword } from '../src/auth.js';
import { prisma } from '../src/db.js';
import {
  collectOffersQueue,
  connection,
  dispatchDeadLetterQueue,
  dispatchOffersQueue,
  enqueueDeadLetterJob
} from '../src/queue.js';

let app: FastifyInstance;
let adminToken = '';
let viewerToken = '';
let deadLetterJobId = '';

async function login(email: string, password: string) {
  const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  assert.equal(response.statusCode, 200, response.body);
  return (response.json() as { token: string }).token;
}

before(async () => {
  await dispatchOffersQueue.obliterate({ force: true });
  await dispatchDeadLetterQueue.obliterate({ force: true });
  await prisma.dispatchLog.deleteMany();
  await prisma.priceHistory.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.alertRule.deleteMany();
  await prisma.dispatchChannel.deleteMany();
  await prisma.marketplaceSource.deleteMany();
  await prisma.user.deleteMany();

  app = await createApp();

  await prisma.user.create({
    data: {
      name: 'Visualizador',
      email: 'viewer-operations@test.local',
      passwordHash: await hashPassword('ViewerOperations123!'),
      role: UserRole.VIEWER,
      isActive: true
    }
  });

  adminToken = await login('admin@test.local', 'TestAdminPassword123!');
  viewerToken = await login('viewer-operations@test.local', 'ViewerOperations123!');

  const offer = await prisma.offer.create({
    data: {
      externalId: 'OPS-DLQ-1',
      marketplace: Marketplace.MERCADO_LIVRE,
      title: 'Notebook para painel operacional',
      normalizedTitle: 'notebook para painel operacional',
      currentPrice: 1999.9,
      originalPrice: 2999.9,
      discountPercent: 33.34,
      productUrl: 'https://example.com/notebook-ops',
      score: 91
    }
  });

  const channel = await prisma.dispatchChannel.create({
    data: { name: 'Webhook operacional', type: 'webhook', config: {}, isActive: true }
  });

  const deadLetter = await enqueueDeadLetterJob({
    offerId: offer.id,
    channelId: channel.id,
    idempotencyKey: 'operations-dashboard-key',
    matchedAlertNames: ['Notebook'],
    enqueuedAt: new Date().toISOString(),
    originalJobId: 'dispatch-operations-dashboard-key',
    failedAt: new Date().toISOString(),
    failedReason: 'Webhook erro 503',
    attemptsMade: 5
  });
  deadLetterJobId = String(deadLetter.id);
});

after(async () => {
  if (app) await app.close();
  await Promise.all([
    collectOffersQueue.close(),
    dispatchOffersQueue.close(),
    dispatchDeadLetterQueue.close()
  ]);
  if (connection.status !== 'end') await connection.quit();
  await prisma.$disconnect();
});

describe('painel operacional da distribuição', () => {
  test('restringe o snapshot ao administrador', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/dispatch/operations',
      headers: { authorization: `Bearer ${viewerToken}` }
    });
    assert.equal(response.statusCode, 403);
  });

  test('retorna filas, falhas e DLQ enriquecida sem segredos', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/dispatch/operations?limit=20',
      headers: { authorization: `Bearer ${adminToken}` }
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json() as {
      queues: { collect: Record<string, number>; dispatch: Record<string, number>; deadLetter: Record<string, number> };
      deadLetters: { total: number; items: Array<{ id: string; attemptsMade: number; failedReason: string; offer: { title: string }; channel: { name: string } }> };
    };

    assert.equal(typeof body.queues.collect.waiting, 'number');
    assert.equal(typeof body.queues.dispatch.waiting, 'number');
    assert.ok(body.deadLetters.total >= 1);
    const item = body.deadLetters.items.find((entry) => entry.id === deadLetterJobId);
    assert.ok(item);
    assert.equal(item.attemptsMade, 5);
    assert.equal(item.failedReason, 'Webhook erro 503');
    assert.equal(item.offer.title, 'Notebook para painel operacional');
    assert.equal(item.channel.name, 'Webhook operacional');
    assert.equal(response.body.includes('apiKey'), false);
    assert.equal(response.body.includes('botToken'), false);
  });

  test('retorna 404 para job inexistente', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/dispatch/dlq/job-inexistente/retry',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(response.statusCode, 404);
  });

  test('reprocessa o job e remove o item original da DLQ', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/admin/dispatch/dlq/${encodeURIComponent(deadLetterJobId)}/retry`,
      headers: { authorization: `Bearer ${adminToken}` }
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json() as { status: string; dispatchJobId: string };
    assert.equal(body.status, 'requeued');
    assert.match(body.dispatchJobId, /-retry-/);
    assert.equal(await dispatchDeadLetterQueue.getJob(deadLetterJobId), undefined);
    assert.ok(await dispatchOffersQueue.getJob(body.dispatchJobId));
  });
});
