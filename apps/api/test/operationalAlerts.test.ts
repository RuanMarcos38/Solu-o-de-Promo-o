import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { operationalConfig } from '../src/operationalConfig.js';
import { formatOperationalAlert, operationalAlertStatus } from '../src/operationalAlerts.js';
import { connection, operationalAlertsQueue, type OperationalAlert } from '../src/queue.js';

const alert: OperationalAlert = {
  kind: 'dlq-threshold',
  severity: 'critical',
  title: 'DLQ atingiu o limite crítico',
  message: 'A fila possui 8 itens para um limite de 5.',
  deduplicationKey: 'incident-1',
  occurredAt: '2026-07-14T17:00:00.000Z',
  details: { total: 8, threshold: 5 }
};

after(async () => {
  await operationalAlertsQueue.close();
  if (connection.status !== 'end') await connection.quit();
});

describe('alertas operacionais', () => {
  test('formata uma mensagem legível para administradores', () => {
    const message = formatOperationalAlert(alert);
    assert.match(message, /CRITICAL/);
    assert.match(message, /DLQ atingiu/);
    assert.match(message, /8 itens/);
    assert.match(message, /2026-07-14/);
  });

  test('expõe somente o estado de configuração, sem segredos', () => {
    const originalToken = operationalConfig.telegramBotToken;
    const originalSecret = operationalConfig.webhookSecret;
    operationalConfig.telegramBotToken = 'token-que-nao-pode-aparecer';
    operationalConfig.webhookSecret = 'segredo-que-nao-pode-aparecer';
    try {
      const serialized = JSON.stringify(operationalAlertStatus());
      assert.equal(serialized.includes(operationalConfig.telegramBotToken), false);
      assert.equal(serialized.includes(operationalConfig.webhookSecret), false);
      assert.match(serialized, /dlqThreshold/);
    } finally {
      operationalConfig.telegramBotToken = originalToken;
      operationalConfig.webhookSecret = originalSecret;
    }
  });
});