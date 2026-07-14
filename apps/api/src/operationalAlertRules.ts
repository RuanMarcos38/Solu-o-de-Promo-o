import { operationalConfig, type OperationalAlertChannel } from './operationalConfig.js';

export type OperationalAlertContent = {
  kind: 'dlq-item' | 'dlq-threshold' | 'dlq-recovery' | 'test';
  severity: 'info' | 'warning' | 'critical' | 'recovery';
  title: string;
  message: string;
  deduplicationKey: string;
  occurredAt: string;
  details: Record<string, unknown>;
};

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

export function formatOperationalAlert(alert: OperationalAlertContent) {
  const dashboard = operationalConfig.dashboardUrl ? `\n\nPainel: ${operationalConfig.dashboardUrl}` : '';
  return `[${alert.severity.toUpperCase()}] ${alert.title}\n\n${alert.message}\n\nOcorrido em: ${alert.occurredAt}${dashboard}`;
}