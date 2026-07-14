import { z } from 'zod';

function readBoolean(name: string, fallback: boolean) {
  const value = process.env[name];
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function readNumber(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const metricsPath = process.env.METRICS_PATH || '/metrics';
const samplingRatio = readNumber('OTEL_SAMPLING_RATIO', 0.1);

if (!metricsPath.startsWith('/')) throw new Error('METRICS_PATH precisa começar com /');
if (samplingRatio < 0 || samplingRatio > 1) throw new Error('OTEL_SAMPLING_RATIO precisa estar entre 0 e 1');

const availabilityTarget = readNumber('SLO_API_AVAILABILITY_TARGET', 0.999);
const dispatchTarget = readNumber('SLO_DISPATCH_SUCCESS_TARGET', 0.98);
const alertTarget = readNumber('SLO_OPERATIONAL_ALERT_SUCCESS_TARGET', 0.99);

for (const [name, value] of [
  ['SLO_API_AVAILABILITY_TARGET', availabilityTarget],
  ['SLO_DISPATCH_SUCCESS_TARGET', dispatchTarget],
  ['SLO_OPERATIONAL_ALERT_SUCCESS_TARGET', alertTarget]
] as const) {
  if (value <= 0 || value > 1) throw new Error(`${name} precisa ser maior que 0 e menor ou igual a 1`);
}

const workerMetricsPort = Math.floor(readNumber('WORKER_METRICS_PORT', 9464));
if (workerMetricsPort < 1 || workerMetricsPort > 65_535) {
  throw new Error('WORKER_METRICS_PORT precisa estar entre 1 e 65535');
}

const metricsEnabled = readBoolean('METRICS_ENABLED', !isProduction);
const metricsBearerToken = process.env.METRICS_BEARER_TOKEN || '';
if (isProduction && metricsEnabled && metricsBearerToken.length < 24) {
  throw new Error('METRICS_BEARER_TOKEN com pelo menos 24 caracteres é obrigatório quando métricas estão habilitadas em produção');
}

const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  || (process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '')}/v1/traces`
    : 'http://localhost:4318/v1/traces');

z.string().url().parse(otelEndpoint);

export const observabilityConfig = {
  metricsEnabled,
  metricsPath,
  metricsBearerToken,
  workerMetricsHost: process.env.WORKER_METRICS_HOST || '0.0.0.0',
  workerMetricsPort,
  collectDefaultMetrics: readBoolean('METRICS_COLLECT_DEFAULTS', nodeEnv !== 'test'),
  otelEnabled: readBoolean('OTEL_ENABLED', false),
  otelEndpoint,
  otelServiceName: process.env.OTEL_SERVICE_NAME || 'promotion-radar',
  otelServiceVersion: process.env.OTEL_SERVICE_VERSION || '0.1.0',
  otelSamplingRatio: samplingRatio,
  deploymentEnvironment: process.env.DEPLOYMENT_ENVIRONMENT || nodeEnv,
  sloWindowDays: Math.max(1, Math.floor(readNumber('SLO_WINDOW_DAYS', 30))),
  sloApiAvailabilityTarget: availabilityTarget,
  sloDispatchSuccessTarget: dispatchTarget,
  sloOperationalAlertSuccessTarget: alertTarget,
  sloQueueLatencyP95Seconds: Math.max(0.1, readNumber('SLO_QUEUE_LATENCY_P95_SECONDS', 30)),
  sloMinimumSamples: Math.max(1, Math.floor(readNumber('SLO_MINIMUM_SAMPLES', 20)))
};

export function publicObservabilityConfig() {
  return {
    metricsEnabled: observabilityConfig.metricsEnabled,
    metricsPath: observabilityConfig.metricsPath,
    workerMetricsPort: observabilityConfig.workerMetricsPort,
    metricsAuthentication: observabilityConfig.metricsBearerToken ? 'bearer-token' : 'admin-jwt',
    openTelemetry: {
      enabled: observabilityConfig.otelEnabled,
      serviceName: observabilityConfig.otelServiceName,
      samplingRatio: observabilityConfig.otelSamplingRatio,
      exporterConfigured: Boolean(observabilityConfig.otelEndpoint)
    },
    slo: {
      windowDays: observabilityConfig.sloWindowDays,
      minimumSamples: observabilityConfig.sloMinimumSamples,
      apiAvailabilityTarget: observabilityConfig.sloApiAvailabilityTarget,
      dispatchSuccessTarget: observabilityConfig.sloDispatchSuccessTarget,
      operationalAlertSuccessTarget: observabilityConfig.sloOperationalAlertSuccessTarget,
      queueLatencyP95Seconds: observabilityConfig.sloQueueLatencyP95Seconds
    }
  };
}
