import { timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';
import type { Job, Queue } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics
} from 'prom-client';
import { observabilityConfig } from './observabilityConfig.js';

const registry = new Registry();
registry.setDefaultLabels({
  service: observabilityConfig.otelServiceName,
  environment: observabilityConfig.deploymentEnvironment
});

if (observabilityConfig.collectDefaultMetrics) {
  collectDefaultMetrics({ register: registry, prefix: 'promotion_radar_' });
}

const httpRequests = new Counter({
  name: 'promotion_radar_http_requests_total',
  help: 'Total de requisições HTTP processadas.',
  labelNames: ['method', 'route', 'status_class'] as const,
  registers: [registry]
});
const httpDuration = new Histogram({
  name: 'promotion_radar_http_request_duration_seconds',
  help: 'Duração das requisições HTTP em segundos.',
  labelNames: ['method', 'route', 'status_class'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry]
});
const queueJobs = new Counter({
  name: 'promotion_radar_queue_jobs_total',
  help: 'Total de execuções de jobs por fila e resultado.',
  labelNames: ['queue', 'result'] as const,
  registers: [registry]
});
const queueJobDuration = new Histogram({
  name: 'promotion_radar_queue_job_duration_seconds',
  help: 'Duração do processamento dos jobs.',
  labelNames: ['queue', 'result'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
  registers: [registry]
});
const queueWaitingDuration = new Histogram({
  name: 'promotion_radar_queue_waiting_duration_seconds',
  help: 'Tempo entre a criação e o início do processamento do job.',
  labelNames: ['queue'] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 900],
  registers: [registry]
});
const queueDepth = new Gauge({
  name: 'promotion_radar_queue_depth',
  help: 'Quantidade atual de jobs por fila e estado.',
  labelNames: ['queue', 'state'] as const,
  registers: [registry]
});
const dispatchAttempts = new Counter({
  name: 'promotion_radar_dispatch_attempts_total',
  help: 'Tentativas de distribuição por tipo de canal e resultado.',
  labelNames: ['channel', 'result'] as const,
  registers: [registry]
});
const operationalAlertDeliveries = new Counter({
  name: 'promotion_radar_operational_alert_deliveries_total',
  help: 'Entregas de alertas operacionais por canal, evento e resultado.',
  labelNames: ['channel', 'kind', 'result'] as const,
  registers: [registry]
});
const dlqItems = new Gauge({
  name: 'promotion_radar_dispatch_dlq_items',
  help: 'Quantidade atual de itens na dead-letter queue.',
  registers: [registry]
});
const serviceInfo = new Gauge({
  name: 'promotion_radar_service_info',
  help: 'Informações estáticas da instância do serviço.',
  labelNames: ['version', 'process_role'] as const,
  registers: [registry]
});

const startedAt = Date.now();
const runtime = {
  api: { total: 0, successful: 0, failed: 0 },
  dispatch: new Map<string, { successful: number; failed: number }>(),
  alerts: new Map<string, { successful: number; failed: number }>(),
  queueLatencies: new Map<string, number[]>()
};

let telemetrySdk: { shutdown: () => Promise<void> } | null = null;
let processRole = 'unknown';
const tracer = trace.getTracer('promotion-radar', observabilityConfig.otelServiceVersion);

function boundedLabel(value: unknown, fallback = 'unknown') {
  const normalized = String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, '-');
  return normalized.slice(0, 80) || fallback;
}

function statusClass(statusCode: number) {
  return `${Math.floor(statusCode / 100)}xx`;
}

function observeRollingLatency(queue: string, seconds: number) {
  const values = runtime.queueLatencies.get(queue) ?? [];
  values.push(seconds);
  if (values.length > 2_000) values.splice(0, values.length - 2_000);
  runtime.queueLatencies.set(queue, values);
}

export function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentileValue * sorted.length) - 1));
  return sorted[index];
}

export function runtimeTelemetrySnapshot() {
  return {
    startedAt: new Date(startedAt).toISOString(),
    uptimeSeconds: Math.max(0, (Date.now() - startedAt) / 1000),
    api: { ...runtime.api },
    dispatch: Object.fromEntries(runtime.dispatch.entries()),
    alerts: Object.fromEntries(runtime.alerts.entries()),
    queueLatencyP95Seconds: Object.fromEntries(
      [...runtime.queueLatencies.entries()].map(([queue, values]) => [queue, percentile(values, 0.95)])
    )
  };
}

export async function initializeOpenTelemetry(role: 'api' | 'worker') {
  processRole = role;
  serviceInfo.labels(observabilityConfig.otelServiceVersion, role).set(1);
  if (!observabilityConfig.otelEnabled || telemetrySdk) return;

  const [sdkModule, exporterModule, resourcesModule, traceBaseModule] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/resources'),
    import('@opentelemetry/sdk-trace-base')
  ]);

  const exporter = new exporterModule.OTLPTraceExporter({ url: observabilityConfig.otelEndpoint });
  const sampler = new traceBaseModule.ParentBasedSampler({
    root: new traceBaseModule.TraceIdRatioBasedSampler(observabilityConfig.otelSamplingRatio)
  });
  const sdk = new sdkModule.NodeSDK({
    traceExporter: exporter,
    sampler,
    resource: resourcesModule.resourceFromAttributes({
      'service.name': `${observabilityConfig.otelServiceName}-${role}`,
      'service.version': observabilityConfig.otelServiceVersion,
      'deployment.environment.name': observabilityConfig.deploymentEnvironment,
      'service.instance.id': `${role}-${process.pid}`
    })
  });
  sdk.start();
  telemetrySdk = sdk;
}

export async function shutdownOpenTelemetry() {
  if (!telemetrySdk) return;
  const sdk = telemetrySdk;
  telemetrySdk = null;
  await sdk.shutdown();
}

export async function withTelemetrySpan<T>(
  name: string,
  attributes: Attributes,
  operation: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : 'unknown error' });
      if (error instanceof Error) span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}

export async function observeQueueJob<T>(queueName: string, job: Job, operation: () => Promise<T>) {
  const queue = boundedLabel(queueName);
  const started = process.hrtime.bigint();
  const waitingSeconds = Math.max(0, (Date.now() - job.timestamp) / 1000);
  queueWaitingDuration.labels(queue).observe(waitingSeconds);
  observeRollingLatency(queue, waitingSeconds);

  return withTelemetrySpan(`queue ${queue}`, {
    'messaging.system': 'bullmq',
    'messaging.destination.name': queue,
    'messaging.operation.name': 'process',
    'messaging.message.id': String(job.id || 'unknown'),
    'promotion_radar.job.attempt': job.attemptsMade + 1,
    'promotion_radar.queue.waiting_seconds': waitingSeconds
  }, async () => {
    try {
      const result = await operation();
      const duration = Number(process.hrtime.bigint() - started) / 1e9;
      queueJobs.labels(queue, 'success').inc();
      queueJobDuration.labels(queue, 'success').observe(duration);
      return result;
    } catch (error) {
      const duration = Number(process.hrtime.bigint() - started) / 1e9;
      queueJobs.labels(queue, 'failure').inc();
      queueJobDuration.labels(queue, 'failure').observe(duration);
      throw error;
    }
  });
}

export function recordDispatchAttempt(channel: string, successful: boolean) {
  const label = boundedLabel(channel);
  const result = successful ? 'success' : 'failure';
  dispatchAttempts.labels(label, result).inc();
  const current = runtime.dispatch.get(label) ?? { successful: 0, failed: 0 };
  if (successful) current.successful += 1;
  else current.failed += 1;
  runtime.dispatch.set(label, current);
}

export function recordOperationalAlertDelivery(channel: string, kind: string, successful: boolean) {
  const channelLabel = boundedLabel(channel);
  const kindLabel = boundedLabel(kind);
  const result = successful ? 'success' : 'failure';
  operationalAlertDeliveries.labels(channelLabel, kindLabel, result).inc();
  const key = `${channelLabel}:${kindLabel}`;
  const current = runtime.alerts.get(key) ?? { successful: 0, failed: 0 };
  if (successful) current.successful += 1;
  else current.failed += 1;
  runtime.alerts.set(key, current);
}

const requestObservations = new WeakMap<object, { started: bigint; span: Span }>();

export function registerHttpTelemetry(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    const route = boundedLabel(request.routeOptions?.url || request.url.split('?')[0], 'unmatched');
    const span = tracer.startSpan(`HTTP ${request.method} ${route}`, {
      attributes: {
        'http.request.method': request.method,
        'http.route': route,
        'server.address': request.hostname,
        'promotion_radar.request.id': request.id
      }
    });
    requestObservations.set(request, { started: process.hrtime.bigint(), span });
  });

  app.addHook('onResponse', async (request, reply) => {
    const observation = requestObservations.get(request);
    if (!observation) return;
    requestObservations.delete(request);
    const route = boundedLabel(request.routeOptions?.url || request.url.split('?')[0], 'unmatched');
    if (route === boundedLabel(observabilityConfig.metricsPath)) {
      observation.span.end();
      return;
    }
    const status = statusClass(reply.statusCode);
    const duration = Number(process.hrtime.bigint() - observation.started) / 1e9;
    httpRequests.labels(request.method, route, status).inc();
    httpDuration.labels(request.method, route, status).observe(duration);
    runtime.api.total += 1;
    if (reply.statusCode < 500) runtime.api.successful += 1;
    else runtime.api.failed += 1;
    observation.span.setAttribute('http.response.status_code', reply.statusCode);
    observation.span.setAttribute('promotion_radar.http.duration_seconds', duration);
    observation.span.setStatus({ code: reply.statusCode >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK });
    observation.span.end();
  });
}

export async function refreshQueueMetrics(queues: Record<string, Queue>) {
  for (const [queueName, queue] of Object.entries(queues)) {
    const label = boundedLabel(queueName);
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused');
    for (const [state, value] of Object.entries(counts)) queueDepth.labels(label, state).set(value);
    if (label.includes('dead-letter')) {
      dlqItems.set(Object.values(counts).reduce((total, value) => total + value, 0));
    }
  }
}

export async function prometheusMetrics() {
  return registry.metrics();
}

function validBearerToken(header: string | undefined) {
  if (!observabilityConfig.metricsBearerToken) return false;
  const value = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = Buffer.from(observabilityConfig.metricsBearerToken);
  const provided = Buffer.from(value);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function isMetricsBearerAuthorized(header: string | undefined) {
  return validBearerToken(header);
}

export async function startWorkerMetricsServer(beforeCollect: () => Promise<void>): Promise<Server | null> {
  if (!observabilityConfig.metricsEnabled) return null;
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok', role: processRole }));
        return;
      }
      if (request.url !== observabilityConfig.metricsPath) {
        response.writeHead(404).end();
        return;
      }
      if (observabilityConfig.metricsBearerToken && !validBearerToken(request.headers.authorization)) {
        response.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end();
        return;
      }
      await beforeCollect();
      response.writeHead(200, { 'Content-Type': registry.contentType });
      response.end(await prometheusMetrics());
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Falha ao coletar métricas' }));
      console.error('[observability] worker metrics failed', error);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(observabilityConfig.workerMetricsPort, observabilityConfig.workerMetricsHost, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

export async function closeMetricsServer(server: Server | null) {
  if (!server) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
