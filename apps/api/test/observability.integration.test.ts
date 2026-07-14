import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { UserRole } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/application.js';
import { hashPassword } from '../src/auth.js';
import { prisma } from '../src/db.js';
import {
  collectOffersQueue,
  connection,
  dispatchDeadLetterQueue,
  dispatchOffersQueue,
  operationalAlertsQueue
} from '../src/queue.js';

let app: FastifyInstance;
let adminToken = '';
let viewerToken = '';

async function login(email: string, password: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password }
  });
  assert.equal(response.statusCode, 200, response.body);
  return (response.json() as { token: string }).token;
}

before(async () => {
  await prisma.user.deleteMany({ where: { email: 'viewer-observability@test.local' } });
  app = await createApp();
  await prisma.user.create({
    data: {
      name: 'Viewer Observabilidade',
      email: 'viewer-observability@test.local',
      passwordHash: await hashPassword('ViewerObservability123!'),
      role: UserRole.VIEWER,
      isActive: true
    }
  });
  adminToken = await login('admin@test.local', 'TestAdminPassword123!');
  viewerToken = await login('viewer-observability@test.local', 'ViewerObservability123!');
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

describe('endpoints de observabilidade', () => {
  test('protege métricas e endpoints administrativos', async () => {
    const anonymousMetrics = await app.inject({ method: 'GET', url: '/metrics' });
    assert.equal(anonymousMetrics.statusCode, 401);

    const viewerStatus = await app.inject({
      method: 'GET',
      url: '/admin/observability/status',
      headers: { authorization: `Bearer ${viewerToken}` }
    });
    assert.equal(viewerStatus.statusCode, 403);
  });

  test('retorna métricas Prometheus para administrador e instrumenta rotas existentes', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);

    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.headers['content-type'] || '', /text\/plain/);
    assert.match(response.body, /promotion_radar_http_requests_total/);
    assert.match(response.body, /promotion_radar_queue_depth/);
    assert.match(response.body, /route="-health"/);
    assert.equal(response.body.includes('TestAdminPassword123!'), false);
  });

  test('expõe configuração sanitizada e snapshot de SLO', async () => {
    const statusResponse = await app.inject({
      method: 'GET',
      url: '/admin/observability/status',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(statusResponse.statusCode, 200, statusResponse.body);
    assert.equal(statusResponse.body.includes('METRICS_BEARER_TOKEN'), false);
    assert.equal(statusResponse.body.includes('OTEL_EXPORTER_OTLP'), false);

    const sloResponse = await app.inject({
      method: 'GET',
      url: '/admin/observability/slo',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(sloResponse.statusCode, 200, sloResponse.body);
    const body = sloResponse.json() as {
      overallState: string;
      objectives: {
        apiAvailability: { state: string; target: number };
        dispatchSuccess: { overall: { state: string } };
        operationalAlertHealth: { overall: { state: string } };
        queueLatency: { targetP95Seconds: number };
      };
    };
    assert.match(body.overallState, /meeting|breached|no_data/);
    assert.ok(body.objectives.apiAvailability.target > 0.99);
    assert.match(body.objectives.dispatchSuccess.overall.state, /meeting|breached|no_data/);
    assert.match(body.objectives.operationalAlertHealth.overall.state, /meeting|breached|no_data/);
    assert.ok(body.objectives.queueLatency.targetP95Seconds > 0);
  });
});
