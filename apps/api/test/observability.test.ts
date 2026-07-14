import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { publicObservabilityConfig } from '../src/observabilityConfig.js';
import { evaluateLatencySlo, evaluateRatioSlo } from '../src/sloRules.js';
import {
  prometheusMetrics,
  recordDispatchAttempt,
  recordOperationalAlertDelivery,
  runtimeTelemetrySnapshot
} from '../src/telemetry.js';

describe('observabilidade e SLO', () => {
  test('avalia objetivo de disponibilidade e orçamento de erro', () => {
    const meeting = evaluateRatioSlo(999, 1000, 0.999, 20);
    assert.equal(meeting.state, 'meeting');
    assert.equal(meeting.ratio, 0.999);
    assert.ok((meeting.errorBudget.burnRate ?? 0) <= 1.01);

    const breached = evaluateRatioSlo(970, 1000, 0.99, 20);
    assert.equal(breached.state, 'breached');
    assert.ok((breached.errorBudget.burnRate ?? 0) > 1);

    const insufficient = evaluateRatioSlo(1, 1, 0.99, 20);
    assert.equal(insufficient.state, 'no_data');
  });

  test('calcula p95 sem esconder falta de amostras', () => {
    const meeting = evaluateLatencySlo([1, 2, 3, 4, 5], 10, 5);
    assert.equal(meeting.state, 'meeting');
    assert.equal(meeting.p95Seconds, 5);

    const breached = evaluateLatencySlo([1, 2, 3, 4, 50], 10, 5);
    assert.equal(breached.state, 'breached');
    assert.equal(breached.p95Seconds, 50);

    assert.equal(evaluateLatencySlo([1], 10, 5).state, 'no_data');
  });

  test('publica métricas com labels limitadas e sem segredos', async () => {
    recordDispatchAttempt('Telegram Principal', true);
    recordDispatchAttempt('Telegram Principal', false);
    recordOperationalAlertDelivery('webhook', 'dlq-threshold', true);

    const text = await prometheusMetrics();
    assert.match(text, /promotion_radar_dispatch_attempts_total/);
    assert.match(text, /channel="telegram-principal"/);
    assert.match(text, /promotion_radar_operational_alert_deliveries_total/);

    const snapshot = runtimeTelemetrySnapshot();
    assert.equal(snapshot.dispatch['telegram-principal'].successful, 1);
    assert.equal(snapshot.dispatch['telegram-principal'].failed, 1);

    const publicConfig = JSON.stringify(publicObservabilityConfig());
    assert.equal(publicConfig.includes('METRICS_BEARER_TOKEN'), false);
    assert.equal(publicConfig.includes('OTEL_EXPORTER_OTLP'), false);
  });
});
