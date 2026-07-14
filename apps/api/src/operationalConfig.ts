const readNumber = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

const readBoolean = (name: string, fallback: boolean) => {
  const value = process.env[name];
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const readList = (name: string, fallback: string[] = []) => {
  const value = process.env[name];
  return (value ? value.split(',') : fallback).map((item) => item.trim()).filter(Boolean);
};

export type OperationalAlertChannel = 'telegram' | 'email' | 'webhook';

const supportedChannels = new Set<OperationalAlertChannel>(['telegram', 'email', 'webhook']);
const requestedChannels = readList('OPERATIONAL_ALERT_CHANNELS', ['telegram', 'email', 'webhook']);
const channels = requestedChannels.map((channel) => channel.toLowerCase()).filter((channel): channel is OperationalAlertChannel => supportedChannels.has(channel as OperationalAlertChannel));

if (channels.length !== requestedChannels.length) {
  const unsupported = requestedChannels.filter((channel) => !supportedChannels.has(channel as OperationalAlertChannel));
  throw new Error(`Canal operacional não suportado: ${unsupported.join(', ')}`);
}

export const operationalConfig = {
  enabled: readBoolean('OPERATIONAL_ALERTS_ENABLED', false),
  channels,
  dlqThreshold: Math.max(1, Math.floor(readNumber('OPERATIONAL_ALERT_DLQ_THRESHOLD', 5))),
  checkIntervalSeconds: Math.max(30, Math.floor(readNumber('OPERATIONAL_ALERT_CHECK_INTERVAL_SECONDS', 60))),
  cooldownSeconds: Math.max(60, Math.floor(readNumber('OPERATIONAL_ALERT_COOLDOWN_SECONDS', 900))),
  recoveryEnabled: readBoolean('OPERATIONAL_ALERT_RECOVERY_ENABLED', true),
  attempts: Math.max(1, Math.floor(readNumber('OPERATIONAL_ALERT_ATTEMPTS', 5))),
  backoffMs: Math.max(1_000, Math.floor(readNumber('OPERATIONAL_ALERT_BACKOFF_MS', 30_000))),
  concurrency: Math.max(1, Math.floor(readNumber('OPERATIONAL_ALERT_CONCURRENCY', 3))),
  telegramBotToken: process.env.OPERATIONAL_ALERT_TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.OPERATIONAL_ALERT_TELEGRAM_CHAT_ID || '',
  webhookUrl: process.env.OPERATIONAL_ALERT_WEBHOOK_URL || '',
  webhookSecret: process.env.OPERATIONAL_ALERT_WEBHOOK_SECRET || '',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Math.max(1, Math.floor(readNumber('SMTP_PORT', 587))),
  smtpSecure: readBoolean('SMTP_SECURE', false),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  emailFrom: process.env.OPERATIONAL_ALERT_EMAIL_FROM || '',
  emailTo: readList('OPERATIONAL_ALERT_EMAIL_TO'),
  dashboardUrl: process.env.OPERATIONAL_ALERT_DASHBOARD_URL || ''
};

export function validateOperationalAlertConfig() {
  if (!operationalConfig.enabled) return;
  if (operationalConfig.channels.length === 0) throw new Error('Nenhum canal de alerta operacional foi configurado');
  if (operationalConfig.channels.includes('telegram') && (!operationalConfig.telegramBotToken || !operationalConfig.telegramChatId)) {
    throw new Error('Telegram operacional está incompleto');
  }
  if (operationalConfig.channels.includes('webhook') && !operationalConfig.webhookUrl) {
    throw new Error('Webhook operacional está incompleto');
  }
  if (operationalConfig.channels.includes('email') && (!operationalConfig.smtpHost || !operationalConfig.emailFrom || operationalConfig.emailTo.length === 0)) {
    throw new Error('E-mail operacional está incompleto');
  }
}