import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireAdmin } from './auth.js';
import { observabilityConfig, publicObservabilityConfig } from './observabilityConfig.js';
import {
  collectOffersQueue,
  dispatchDeadLetterQueue,
  dispatchOffersQueue,
  operationalAlertsQueue
} from './queue.js';
import { getSloSnapshot } from './slo.js';
import {
  isMetricsBearerAuthorized,
  prometheusMetrics,
  refreshQueueMetrics,
  registerHttpTelemetry
} from './telemetry.js';

async function authorizeMetrics(request: FastifyRequest) {
  if (isMetricsBearerAuthorized(request.headers.authorization)) return;
  await requireAdmin(request);
}

async function refreshAllQueues() {
  await refreshQueueMetrics({
    'collect-offers': collectOffersQueue,
    'dispatch-offers': dispatchOffersQueue,
    'dispatch-dead-letter': dispatchDeadLetterQueue,
    'operational-alerts': operationalAlertsQueue
  });
}

export async function registerObservabilityRoutes(app: FastifyInstance) {
  registerHttpTelemetry(app);

  app.get(observabilityConfig.metricsPath, {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    if (!observabilityConfig.metricsEnabled) {
      return reply.status(404).send({ message: 'Métricas desabilitadas' });
    }
    await authorizeMetrics(request);
    await refreshAllQueues();
    return reply
      .header('Cache-Control', 'no-store')
      .type('text/plain; version=0.0.4; charset=utf-8')
      .send(await prometheusMetrics());
  });

  app.get('/admin/observability/status', async (request) => {
    await requireAdmin(request);
    return {
      status: 'ok',
      configuration: publicObservabilityConfig(),
      runtime: {
        processRole: 'api',
        metricsEndpoint: observabilityConfig.metricsPath,
        workerMetricsEndpoint: `http://worker:${observabilityConfig.workerMetricsPort}${observabilityConfig.metricsPath}`
      }
    };
  });

  app.get('/admin/observability/slo', async (request) => {
    await requireAdmin(request);
    return getSloSnapshot();
  });
}
