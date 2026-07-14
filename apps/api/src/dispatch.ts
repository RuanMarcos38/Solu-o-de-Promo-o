import { createHash } from 'node:crypto';
import { DispatchStatus, type DispatchChannel, type DispatchLog, type Offer, Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { prisma } from './db.js';
import { fetchExternal } from './http.js';
import {
  enqueueDeadLetterJob,
  enqueueDispatchJob,
  type DispatchDeadLetterData,
  type DispatchJobData
} from './queue.js';
import { decryptChannelConfig } from './secrets.js';

export type ChannelConfig = Record<string, any>;
export type OfferForDispatch = {
  id: string;
  title: string;
  currentPrice: number;
  discountPercent?: number;
  productUrl: string;
  affiliateUrl?: string;
  marketplace: string;
  score: number;
};

export type AlertForMatch = {
  name: string;
  keywords: string[];
  marketplaces: string[];
  minDiscountPercent: number;
  maxPrice: unknown;
};

export type DispatchEnqueueResult = {
  queued: number;
  duplicates: number;
  skipped: boolean;
  jobIds: string[];
};

function normalize(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toDispatchOffer(offer: Offer): OfferForDispatch {
  return {
    id: offer.id,
    title: offer.title,
    currentPrice: Number(offer.currentPrice),
    discountPercent: offer.discountPercent === null ? undefined : Number(offer.discountPercent),
    productUrl: offer.productUrl,
    affiliateUrl: offer.affiliateUrl ?? undefined,
    marketplace: String(offer.marketplace).toLowerCase(),
    score: offer.score
  };
}

export function formatOfferMessage(offer: OfferForDispatch) {
  const price = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(offer.currentPrice);
  const discount = offer.discountPercent ? `\n🔥 Desconto: ${offer.discountPercent}% OFF` : '';
  const link = offer.affiliateUrl || offer.productUrl;
  return `🚨 Oferta encontrada!\n\n${offer.title}\n💰 ${price}${discount}\n⭐ Score: ${offer.score}\n🛒 ${link}`;
}

export function offerMatchesAlert(offer: OfferForDispatch, alert: AlertForMatch) {
  const title = normalize(offer.title);
  const marketplace = normalize(offer.marketplace);
  const alertMarketplaces = alert.marketplaces.map(normalize).filter(Boolean);
  const alertKeywords = alert.keywords.map(normalize).filter(Boolean);
  const discount = offer.discountPercent ?? 0;
  const maxPrice = alert.maxPrice === null || alert.maxPrice === undefined ? null : Number(alert.maxPrice);

  if (alertMarketplaces.length > 0 && !alertMarketplaces.includes(marketplace)) return false;
  if (alertKeywords.length > 0 && !alertKeywords.some((keyword) => title.includes(keyword))) return false;
  if (discount < alert.minDiscountPercent) return false;
  if (maxPrice !== null && Number.isFinite(maxPrice) && offer.currentPrice > maxPrice) return false;
  return true;
}

export function buildDispatchIdempotencyKey(
  offer: OfferForDispatch,
  channelId: string,
  eventScope = 'production'
) {
  const fingerprint = JSON.stringify({
    eventScope,
    offerId: offer.id,
    channelId,
    currentPrice: offer.currentPrice,
    discountPercent: offer.discountPercent ?? null,
    score: offer.score,
    targetUrl: offer.affiliateUrl || offer.productUrl
  });

  return createHash('sha256').update(fingerprint).digest('hex');
}

async function getMatchedAlerts(offer: OfferForDispatch) {
  const alerts = await prisma.alertRule.findMany({ where: { isActive: true } });
  return {
    activeAlertCount: alerts.length,
    matchedAlerts: alerts.filter((alert) => offerMatchesAlert(offer, alert))
  };
}

async function sendTelegram(config: ChannelConfig, message: string) {
  const botToken = config.botToken || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = config.chatId || process.env.TELEGRAM_CHANNEL_ID;
  if (!botToken || !chatId) throw new Error('Telegram sem botToken/chatId');

  const response = await fetchExternal(`https://api.telegram.org/bot${encodeURIComponent(String(botToken))}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: false })
  });

  if (!response.ok) throw new Error(`Telegram erro ${response.status}`);
}

async function sendWebhook(config: ChannelConfig, payload: unknown) {
  if (!config.url) throw new Error('Webhook sem URL');
  const method = String(config.method || 'POST').toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(method)) throw new Error('Método de webhook não permitido');

  const response = await fetchExternal(String(config.url), {
    method,
    headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Webhook erro ${response.status}`);
}

async function sendEvolutionWhatsapp(config: ChannelConfig, message: string) {
  const baseUrl = String(config.baseUrl || process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
  const apiKey = config.apiKey || process.env.EVOLUTION_API_KEY;
  const instanceName = config.instanceName || process.env.EVOLUTION_INSTANCE_NAME;
  const number = config.number || config.to || process.env.WHATSAPP_DEFAULT_TO;
  if (!baseUrl || !apiKey || !instanceName || !number) throw new Error('Evolution API sem baseUrl/apiKey/instanceName/number');

  const response = await fetchExternal(`${baseUrl}/message/sendText/${encodeURIComponent(String(instanceName))}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: String(apiKey) },
    body: JSON.stringify({ number, text: message })
  });

  if (!response.ok) throw new Error(`Evolution API erro ${response.status}`);
}

async function sendWhatsapp(config: ChannelConfig, message: string, offer: OfferForDispatch) {
  if (config.provider === 'evolution' || config.baseUrl || config.instanceName) {
    await sendEvolutionWhatsapp(config, message);
    return;
  }

  const url = config.url || process.env.WHATSAPP_PROVIDER_URL;
  const token = config.token || process.env.WHATSAPP_PROVIDER_TOKEN;
  const to = config.to || process.env.WHATSAPP_DEFAULT_TO;
  if (!url || !to) throw new Error('WhatsApp sem URL/destinatário');

  const response = await fetchExternal(String(url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ to, message, offer })
  });

  if (!response.ok) throw new Error(`WhatsApp provider erro ${response.status}`);
}

async function sendToChannel(
  channel: DispatchChannel,
  offer: OfferForDispatch,
  matchedAlertNames: string[]
) {
  const channelConfig = decryptChannelConfig(channel.config) as ChannelConfig;
  const message = formatOfferMessage(offer);

  if (channel.type === 'telegram') await sendTelegram(channelConfig, message);
  else if (channel.type === 'whatsapp') await sendWhatsapp(channelConfig, message, offer);
  else if (channel.type === 'evolution') await sendEvolutionWhatsapp(channelConfig, message);
  else if (channel.type === 'webhook') await sendWebhook(channelConfig, { message, offer, matchedAlerts: matchedAlertNames });
  else throw new Error(`Canal não suportado: ${channel.type}`);
}

async function findDispatchLog(idempotencyKey: string) {
  return prisma.dispatchLog.findFirst({
    where: {
      payload: {
        path: ['idempotencyKey'],
        equals: idempotencyKey
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

async function writeDispatchLog(input: {
  existing?: DispatchLog | null;
  offerId: string;
  channelName: string;
  status: DispatchStatus;
  error?: string | null;
  payload: Record<string, unknown>;
}) {
  if (input.existing) {
    return prisma.dispatchLog.update({
      where: { id: input.existing.id },
      data: {
        channel: input.channelName,
        status: input.status,
        error: input.error ?? null,
        payload: input.payload as Prisma.InputJsonValue
      }
    });
  }

  return prisma.dispatchLog.create({
    data: {
      offerId: input.offerId,
      channel: input.channelName,
      status: input.status,
      error: input.error ?? null,
      payload: input.payload as Prisma.InputJsonValue
    }
  });
}

async function createSkippedAlertLog(offer: OfferForDispatch, idempotencyKey: string) {
  const existing = await findDispatchLog(idempotencyKey);
  if (existing) return existing;

  return writeDispatchLog({
    offerId: offer.id,
    channelName: 'alert-filter',
    status: DispatchStatus.SKIPPED,
    payload: {
      idempotencyKey,
      reason: 'no_alert_match',
      marketplace: offer.marketplace,
      score: offer.score,
      skippedAt: new Date().toISOString()
    }
  });
}

export async function dispatchOffer(
  offer: OfferForDispatch,
  options: { force?: boolean } = {}
): Promise<DispatchEnqueueResult> {
  const { activeAlertCount, matchedAlerts } = await getMatchedAlerts(offer);
  const forceScope = options.force ? `manual-${Date.now()}-${Math.random().toString(36).slice(2)}` : 'production';

  if (activeAlertCount > 0 && matchedAlerts.length === 0) {
    const skipKey = buildDispatchIdempotencyKey(offer, 'alert-filter', forceScope);
    await createSkippedAlertLog(offer, skipKey);
    return { queued: 0, duplicates: 0, skipped: true, jobIds: [] };
  }

  const channels = await prisma.dispatchChannel.findMany({ where: { isActive: true } });
  const matchedAlertNames = matchedAlerts.map((alert) => alert.name);
  const result: DispatchEnqueueResult = { queued: 0, duplicates: 0, skipped: false, jobIds: [] };

  for (const channel of channels) {
    const idempotencyKey = buildDispatchIdempotencyKey(offer, channel.id, forceScope);
    const queued = await enqueueDispatchJob({
      offerId: offer.id,
      channelId: channel.id,
      idempotencyKey,
      matchedAlertNames,
      enqueuedAt: new Date().toISOString()
    });

    if (queued.created) result.queued += 1;
    else result.duplicates += 1;
    if (queued.job.id) result.jobIds.push(queued.job.id);
  }

  return result;
}

export async function processDispatchJob(job: Job<DispatchJobData>) {
  const { offerId, channelId, idempotencyKey, matchedAlertNames } = job.data;
  const attemptNumber = job.attemptsMade + 1;
  const [offerRecord, channel, existing] = await Promise.all([
    prisma.offer.findUnique({ where: { id: offerId } }),
    prisma.dispatchChannel.findUnique({ where: { id: channelId } }),
    findDispatchLog(idempotencyKey)
  ]);

  if (existing?.status === DispatchStatus.SENT) {
    return { status: 'already-sent', logId: existing.id };
  }

  if (!offerRecord || !channel || !channel.isActive) {
    const skipped = await writeDispatchLog({
      existing,
      offerId,
      channelName: channel?.name ?? 'canal-indisponivel',
      status: DispatchStatus.SKIPPED,
      payload: {
        ...jsonObject(existing?.payload ?? null),
        idempotencyKey,
        channelId,
        jobId: job.id,
        attemptNumber,
        reason: !offerRecord ? 'offer_not_found' : !channel ? 'channel_not_found' : 'channel_inactive',
        skippedAt: new Date().toISOString()
      }
    });
    return { status: 'skipped', logId: skipped.id };
  }

  const offer = toDispatchOffer(offerRecord);
  const basePayload = {
    ...jsonObject(existing?.payload ?? null),
    idempotencyKey,
    channelId,
    channelType: channel.type,
    jobId: job.id,
    replayOf: job.data.replayOf ?? null,
    matchedAlerts: matchedAlertNames,
    attemptNumber,
    lastAttemptAt: new Date().toISOString(),
    deadLetter: false
  };

  const pending = await writeDispatchLog({
    existing,
    offerId,
    channelName: channel.name,
    status: DispatchStatus.PENDING,
    payload: basePayload
  });

  try {
    await sendToChannel(channel, offer, matchedAlertNames);
    const sent = await writeDispatchLog({
      existing: pending,
      offerId,
      channelName: channel.name,
      status: DispatchStatus.SENT,
      payload: {
        ...basePayload,
        sentAt: new Date().toISOString()
      }
    });
    return { status: 'sent', logId: sent.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    await writeDispatchLog({
      existing: pending,
      offerId,
      channelName: channel.name,
      status: DispatchStatus.FAILED,
      error: message,
      payload: {
        ...basePayload,
        failedAt: new Date().toISOString()
      }
    });
    throw error;
  }
}

export async function moveDispatchJobToDeadLetter(
  job: Job<DispatchJobData>,
  error: Error
) {
  const originalJobId = job.id ?? `dispatch-${job.data.idempotencyKey}`;
  const deadLetterData: DispatchDeadLetterData = {
    ...job.data,
    originalJobId,
    failedAt: new Date().toISOString(),
    failedReason: error.message,
    attemptsMade: job.attemptsMade
  };

  const deadLetterJob = await enqueueDeadLetterJob(deadLetterData);
  const existing = await findDispatchLog(job.data.idempotencyKey);
  if (existing) {
    await writeDispatchLog({
      existing,
      offerId: job.data.offerId,
      channelName: existing.channel,
      status: DispatchStatus.FAILED,
      error: `[DLQ] ${error.message}`,
      payload: {
        ...jsonObject(existing.payload),
        deadLetter: true,
        deadLetterJobId: deadLetterJob.id,
        deadLetteredAt: new Date().toISOString(),
        attemptsMade: job.attemptsMade
      }
    });
  }

  return deadLetterJob;
}

export async function dispatchOffers(offers: OfferForDispatch[]) {
  const results: DispatchEnqueueResult[] = [];
  for (const offer of offers) results.push(await dispatchOffer(offer));
  return results;
}
