import { createHmac, randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import nodemailer from 'nodemailer';
import { fetchExternal } from './http.js';
import { operationalConfig, type OperationalAlertChannel, validateOperationalAlertConfig } from './operationalConfig.js';
import {
  connection,
  dispatchDeadLetterQueue,
  enqueueOperationalAlert,
  operationalAlertsQueue,
  type DispatchDeadLetterData,
  type OperationalAlert,
  type OperationalAlertQueueData
} from './queue.js';

const DLQ_STATE_KEY = 'operational-alerts:dlq:state';
const DLQ_INCIDENT_KEY = 'operational-alerts:dlq:incident';
const DLQ_REMINDER_KEY = 'operational-alerts:dlq:reminder';
const DLQ_MONITOR_LOCK_KEY = 'operational-alerts:dlq:monitor-lock';

function configuredChannel(channel: OperationalAlertChannel) {
  if (channel === 'telegram') return Boolean(operationalConfig.telegramBotToken && operationalConfig.telegramChatId);
  if (channel === 'webhook') return Boolean(operationalConfig.webhookUrl);
  return Boolean(operationalConfig.smtpHost && operationalConfig.emailFrom && operationalConfig.emailTo.length > 0);
}

export function operationalAlertStatus() {
  return {
    enabled: operationalConfig.enabled,
    channels: operationalConfig.channels.map((channel) => ({ channel, configured: configuredChannel(channel) })),
    dlqThreshold: operationalConfig.dlqThreshold,
    checkIntervalSeconds: operationalConfig.checkIntervalSeconds,
    cooldownSeconds: operationalConfig.cooldownSeconds,
    recoveryEnabled: operationalConfig.recoveryEnabled
  };
}

export function formatOperationalAlert(alert: OperationalAlert) {
  const dashboard = operationalConfig.dashboardUrl ? `\n\nPainel: ${operationalConfig.dashboardUrl}` : '';
  return `[${alert.severity.toUpperCase()}] ${alert.title}\n\n${alert.message}\n\nOcorrido em: ${alert.occurredAt}${dashboard}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function sendTelegram(alert: OperationalAlert) {
  const response = await fetchExternal(`https://api.telegram.org/bot${encodeURIComponent(operationalConfig.telegramBotToken)}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: operationalConfig.telegramChatId,
      text: formatOperationalAlert(alert),
      disable_web_page_preview: true
    })
  });
  if (!response.ok) throw new Error(`Telegram operacional retornou ${response.status}`);
}

async function sendWebhook(alert: OperationalAlert) {
  const body = JSON.stringify({
    event: alert.kind,
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
    occurredAt: alert.occurredAt,
    details: alert.details
  });
  const signature = operationalConfig.webhookSecret
    ? createHmac('sha256', operationalConfig.webhookSecret).update(body).digest('hex')
    : '';
  const response = await fetchExternal(operationalConfig.webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Operational-Alert-Event': alert.kind,
      ...(signature ? { 'X-Operational-Alert-Signature': `sha256=${signature}` } : {})
    },
    body
  });
  if (!response.ok) throw new Error(`Webhook operacional retornou ${response.status}`);
}

async function sendEmail(alert: OperationalAlert) {
  const transport = nodemailer.createTransport({
    host: operationalConfig.smtpHost,
    port: operationalConfig.smtpPort,
    secure: operationalConfig.smtpSecure,
    ...(operationalConfig.smtpUser
      ? { auth: { user: operationalConfig.smtpUser, pass: operationalConfig.smtpPass } }
      : {})
  });
  const text = formatOperationalAlert(alert);
  const details = escapeHtml(JSON.stringify(alert.details, null, 2));
  await transport.sendMail({
    from: operationalConfig.emailFrom,
    to: operationalConfig.emailTo.join(', '),
    subject: `[Radar de Ofertas] ${alert.title}`,
    text,
    html: `<h2>${escapeHtml(alert.title)}</h2><p>${escapeHtml(alert.message)}</p><p><strong>Severidade:</strong> ${escapeHtml(alert.severity)}</p><p><strong>Ocorrido em:</strong> ${escapeHtml(alert.occurredAt)}</p><pre>${details}</pre>${operationalConfig.dashboardUrl ? `<p><a href="${escapeHtml(operationalConfig.dashboardUrl)}">Abrir painel operacional</a></p>` : ''}`
  });
}

export async function processOperationalAlertDelivery(job: Job<OperationalAlertQueueData>) {
  if (job.data.type !== 'delivery') return monitorDlqThreshold();
  if (!operationalConfig.enabled) return { status: 'disabled' };
  validateOperationalAlertConfig();
  const { channel, alert } = job.data;
  if (channel === 'telegram') await sendTelegram(alert);
  else if (channel === 'webhook') await sendWebhook(alert);
  else await sendEmail(alert);
  return { status: 'sent', channel, kind: alert.kind };
}

export async function queueDeadLetterOperationalAlert(data: DispatchDeadLetterData, deadLetterJobId: string) {
  if (!operationalConfig.enabled) return [];
  validateOperationalAlertConfig();
  const alert: OperationalAlert = {
    kind: 'dlq-item',
    severity: 'warning',
    title: 'Nova entrega adicionada à DLQ',
    message: `O envio ${data.originalJobId} esgotou ${data.attemptsMade} tentativa(s). Motivo: ${data.failedReason}`,
    deduplicationKey: `dlq-item:${deadLetterJobId}`,
    occurredAt: data.failedAt,
    details: {
      deadLetterJobId,
      originalJobId: data.originalJobId,
      offerId: data.offerId,
      channelId: data.channelId,
      attemptsMade: data.attemptsMade,
      failedReason: data.failedReason
    }
  };
  return enqueueOperationalAlert(alert);
}

export async function enqueueTestOperationalAlert(requestedBy: string) {
  if (!operationalConfig.enabled) throw new Error('Alertas operacionais estão desabilitados');
  validateOperationalAlertConfig();
  const occurredAt = new Date().toISOString();
  return enqueueOperationalAlert({
    kind: 'test',
    severity: 'info',
    title: 'Teste de alerta operacional',
    message: `Alerta de teste solicitado por ${requestedBy}.`,
    deduplicationKey: `test:${requestedBy}:${Date.now()}`,
    occurredAt,
    details: { requestedBy }
  });
}

async function dlqTotal() {
  const counts = await dispatchDeadLetterQueue.getJobCounts('waiting', 'delayed', 'failed', 'completed', 'paused');
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

async function releaseMonitorLock(lockValue: string) {
  await connection.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    DLQ_MONITOR_LOCK_KEY,
    lockValue
  );
}

export async function monitorDlqThreshold() {
  if (!operationalConfig.enabled) return { status: 'disabled' };
  validateOperationalAlertConfig();
  const lockValue = randomUUID();
  const acquired = await connection.set(DLQ_MONITOR_LOCK_KEY, lockValue, 'EX', 30, 'NX');
  if (!acquired) return { status: 'locked' };

  try {
    const total = await dlqTotal();
    const state = await connection.get(DLQ_STATE_KEY) ?? 'normal';
    const threshold = operationalConfig.dlqThreshold;

    if (total >= threshold) {
      let incidentId = await connection.get(DLQ_INCIDENT_KEY);
      const enteringCritical = state !== 'critical' || !incidentId;
      const reminderExists = Boolean(await connection.get(DLQ_REMINDER_KEY));

      if (enteringCritical) {
        incidentId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
        await connection.set(DLQ_STATE_KEY, 'critical');
        await connection.set(DLQ_INCIDENT_KEY, incidentId);
      }

      if (enteringCritical || !reminderExists) {
        const reminderBucket = Math.floor(Date.now() / (operationalConfig.cooldownSeconds * 1000));
        await enqueueOperationalAlert({
          kind: 'dlq-threshold',
          severity: 'critical',
          title: enteringCritical ? 'DLQ atingiu o limite crítico' : 'DLQ continua acima do limite crítico',
          message: `A dead-letter queue possui ${total} item(ns), acima do limite configurado de ${threshold}.`,
          deduplicationKey: enteringCritical ? `dlq-threshold:${incidentId}` : `dlq-threshold-reminder:${incidentId}:${reminderBucket}`,
          occurredAt: new Date().toISOString(),
          details: { total, threshold, incidentId, reminder: !enteringCritical }
        });
        await connection.set(DLQ_REMINDER_KEY, '1', 'EX', operationalConfig.cooldownSeconds);
      }

      return { status: enteringCritical ? 'critical-entered' : 'critical', total, threshold };
    }

    if (state === 'critical') {
      const incidentId = await connection.get(DLQ_INCIDENT_KEY) ?? 'unknown';
      await connection.set(DLQ_STATE_KEY, 'normal');
      await connection.del(DLQ_INCIDENT_KEY, DLQ_REMINDER_KEY);
      if (operationalConfig.recoveryEnabled) {
        await enqueueOperationalAlert({
          kind: 'dlq-recovery',
          severity: 'recovery',
          title: 'DLQ voltou ao nível normal',
          message: `A dead-letter queue agora possui ${total} item(ns), abaixo do limite de ${threshold}.`,
          deduplicationKey: `dlq-recovery:${incidentId}`,
          occurredAt: new Date().toISOString(),
          details: { total, threshold, incidentId }
        });
      }
      return { status: 'recovered', total, threshold };
    }

    await connection.set(DLQ_STATE_KEY, 'normal');
    return { status: 'normal', total, threshold };
  } finally {
    await releaseMonitorLock(lockValue);
  }
}

export async function operationalAlertQueueStatus() {
  const counts = await operationalAlertsQueue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused');
  return { ...operationalAlertStatus(), queue: counts };
}