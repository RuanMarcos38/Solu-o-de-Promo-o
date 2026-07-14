import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { DispatchStatus, UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/bootstrap.js';
import { hashPassword } from '../src/auth.js';
import { prisma } from '../src/db.js';
import { dispatchOffer, moveDispatchJobToDeadLetter, processDispatchJob } from '../src/dispatch.js';
import { upsertOffers } from '../src/offerStore.js';
import {
  collectOffersQueue,
  connection,
  dispatchDeadLetterQueue,
  dispatchOffersQueue,
  retryDeadLetterJob
} from '../src/queue.js';
import type { NormalizedOffer } from '../src/types.js';

let app: FastifyInstance;
let adminToken = '';
let editorToken = '';
let viewerToken = '';
let viewerId = '';

async function resetDatabase() {
  await prisma.dispatchLog.deleteMany();
  await prisma.priceHistory.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.alertRule.deleteMany();
  await prisma.dispatchChannel.deleteMany();
  await prisma.marketplaceSource.deleteMany();
  await prisma.user.deleteMany();
}

async function resetDispatchQueues() {
  await dispatchOffersQueue.obliterate({ force: true });
  await dispatchDeadLetterQueue.obliterate({ force: true });
}

async function login(email: string, password: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password }
  });

  assert.equal(response.statusCode, 200, response.body);
  const body = response.json() as { token: string };
  assert.ok(body.token);
  return body.token;
}

async function createUser(input: { name: string; email: string; password: string; role: UserRole }) {
  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      isActive: true
    }
  });
}

before(async () => {
  await resetDispatchQueues();
  await resetDatabase();
  app = await createApp();

  const editor = await createUser({
    name: 'Editor Teste',
    email: 'editor@test.local',
    password: 'EditorPassword123!',
    role: UserRole.EDITOR
  });
  assert.ok(editor.id);

  const viewer = await createUser({
    name: 'Viewer Teste',
    email: 'viewer@test.local',
    password: 'ViewerPassword123!',
    role: UserRole.VIEWER
  });
  viewerId = viewer.id;

  adminToken = await login('admin@test.local', 'TestAdminPassword123!');
  editorToken = await login('editor@test.local', 'EditorPassword123!');
  viewerToken = await login('viewer@test.local', 'ViewerPassword123!');
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

describe('API integrada', () => {
  test('rejeita credenciais inválidas sem revelar o motivo', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@test.local', password: 'senha-incorreta' }
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { message: 'E-mail ou senha inválidos' });
  });

  test('aplica RBAC para VIEWER, EDITOR e ADMIN', async () => {
    const viewerCreateAlert = await app.inject({
      method: 'POST',
      url: '/alerts',
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { name: 'Alerta bloqueado', keywords: ['iphone'] }
    });
    assert.equal(viewerCreateAlert.statusCode, 403);

    const viewerSystem = await app.inject({
      method: 'GET',
      url: '/admin/system',
      headers: { authorization: `Bearer ${viewerToken}` }
    });
    assert.equal(viewerSystem.statusCode, 403);

    const editorCreateAlert = await app.inject({
      method: 'POST',
      url: '/alerts',
      headers: { authorization: `Bearer ${editorToken}` },
      payload: {
        name: 'Alerta autorizado',
        keywords: ['notebook'],
        marketplaces: ['mercadolivre'],
        minDiscountPercent: 20,
        maxPrice: 4000
      }
    });
    assert.equal(editorCreateAlert.statusCode, 201, editorCreateAlert.body);

    const editorUsers = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { authorization: `Bearer ${editorToken}` }
    });
    assert.equal(editorUsers.statusCode, 403);

    const adminUsers = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminUsers.statusCode, 200, adminUsers.body);
    assert.ok((adminUsers.json() as { users: unknown[] }).users.length >= 3);
  });

  test('revoga imediatamente o JWT de usuário desativado', async () => {
    await prisma.user.update({ where: { id: viewerId }, data: { isActive: false } });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${viewerToken}` }
    });

    assert.equal(response.statusCode, 401);
    assert.match((response.json() as { message: string }).message, /inativo|inexistente/i);
  });

  test('retorna 400 para payload inválido', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'A', email: 'email-invalido', password: '123', role: 'ADMIN' }
    });

    assert.equal(response.statusCode, 400);
    const body = response.json() as { message: string; issues: unknown[] };
    assert.equal(body.message, 'Dados inválidos');
    assert.ok(body.issues.length >= 1);
  });

  test('criptografa configuração do canal e nunca devolve o token', async () => {
    const secret = 'telegram-token-super-secreto';
    const response = await app.inject({
      method: 'POST',
      url: '/dispatch/channels',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Telegram Teste',
        type: 'telegram',
        isActive: false,
        config: { botToken: secret, chatId: '-100123456' }
      }
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.body.includes(secret), false);

    const body = response.json() as {
      channel: { id: string; configSummary: Record<string, unknown>; config?: unknown };
    };
    assert.equal(body.channel.config, undefined);
    assert.equal(body.channel.configSummary.botTokenConfigured, true);

    const stored = await prisma.dispatchChannel.findUniqueOrThrow({ where: { id: body.channel.id } });
    assert.equal(JSON.stringify(stored.config).includes(secret), false);
    assert.equal((stored.config as Record<string, unknown>).__encrypted, true);
  });

  test('não publica novamente oferta idêntica e publica quando o score melhora', async () => {
    const offer: NormalizedOffer = {
      externalId: 'MLB-DEDUP-1',
      marketplace: 'mercadolivre',
      title: 'Notebook Gamer Deduplicação',
      normalizedTitle: 'notebook gamer deduplicacao',
      currentPrice: 2499.9,
      originalPrice: 3999.9,
      discountPercent: 37.5,
      imageUrl: 'https://example.com/notebook.jpg',
      productUrl: 'https://example.com/notebook',
      sellerName: 'Loja Oficial',
      rating: 4.8,
      freeShipping: true,
      score: 90
    };

    const first = await upsertOffers([offer]);
    const duplicate = await upsertOffers([offer]);
    const improved = await upsertOffers([{ ...offer, score: 95 }]);

    assert.equal(first.length, 1);
    assert.equal(duplicate.length, 0);
    assert.equal(improved.length, 1);
    assert.equal(await prisma.offer.count({ where: { externalId: offer.externalId } }), 1);
  });

  test('aplica idempotência, registra falha, move para DLQ e permite replay', async () => {
    await resetDispatchQueues();
    await prisma.dispatchLog.deleteMany();
    await prisma.alertRule.deleteMany();
    await prisma.dispatchChannel.deleteMany();

    const storedOffer = await prisma.offer.findFirstOrThrow({ where: { externalId: 'MLB-DEDUP-1' } });
    const dispatchInput = {
      id: storedOffer.id,
      title: storedOffer.title,
      currentPrice: Number(storedOffer.currentPrice),
      discountPercent: storedOffer.discountPercent ? Number(storedOffer.discountPercent) : undefined,
      productUrl: storedOffer.productUrl,
      affiliateUrl: storedOffer.affiliateUrl ?? undefined,
      marketplace: 'mercadolivre',
      score: storedOffer.score
    };

    await prisma.alertRule.create({
      data: {
        name: 'Somente geladeiras',
        keywords: ['geladeira'],
        marketplaces: ['mercadolivre'],
        minDiscountPercent: 10,
        isActive: true
      }
    });

    const skippedResult = await dispatchOffer(dispatchInput);
    assert.equal(skippedResult.skipped, true);
    const skipped = await prisma.dispatchLog.findFirstOrThrow({ where: { offerId: storedOffer.id } });
    assert.equal(skipped.status, DispatchStatus.SKIPPED);
    assert.equal(skipped.channel, 'alert-filter');

    await prisma.dispatchLog.deleteMany();
    await prisma.alertRule.deleteMany();
    const channel = await prisma.dispatchChannel.create({
      data: {
        name: 'Canal inválido controlado',
        type: 'unsupported',
        config: {},
        isActive: true
      }
    });

    const firstEnqueue = await dispatchOffer(dispatchInput);
    const duplicateEnqueue = await dispatchOffer(dispatchInput);
    assert.equal(firstEnqueue.queued, 1);
    assert.equal(firstEnqueue.duplicates, 0);
    assert.equal(duplicateEnqueue.queued, 0);
    assert.equal(duplicateEnqueue.duplicates, 1);
    assert.equal(firstEnqueue.jobIds.length, 1);

    const job = await dispatchOffersQueue.getJob(firstEnqueue.jobIds[0]);
    assert.ok(job);
    assert.equal(job.data.channelId, channel.id);

    await assert.rejects(() => processDispatchJob(job), /Canal não suportado/);
    const failed = await prisma.dispatchLog.findFirstOrThrow({ where: { offerId: storedOffer.id } });
    assert.equal(failed.status, DispatchStatus.FAILED);
    assert.match(failed.error ?? '', /Canal não suportado/);

    const deadLetter = await moveDispatchJobToDeadLetter(job, new Error('Canal não suportado: unsupported'));
    assert.ok(deadLetter.id);
    const deadLetterId = deadLetter.id as string;
    const storedDeadLetter = await dispatchDeadLetterQueue.getJob(deadLetterId);
    assert.ok(storedDeadLetter);

    const deadLetterLog = await prisma.dispatchLog.findUniqueOrThrow({ where: { id: failed.id } });
    const deadLetterPayload = deadLetterLog.payload as Record<string, unknown>;
    assert.equal(deadLetterPayload.deadLetter, true);
    assert.equal(deadLetterPayload.deadLetterJobId, deadLetterId);

    const replay = await retryDeadLetterJob(deadLetterId);
    assert.ok(replay?.id);
    assert.match(String(replay?.id), /-retry-/);
    assert.equal(await dispatchDeadLetterQueue.getJob(deadLetterId), undefined);
  });
});
