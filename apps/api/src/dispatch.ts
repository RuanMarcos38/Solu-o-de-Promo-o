import { DispatchStatus } from '@prisma/client';
import { prisma } from './db.js';
import { fetchExternal } from './http.js';
import { decryptChannelConfig } from './secrets.js';

type ChannelConfig = Record<string, any>;
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

function normalize(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
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

async function getMatchedAlerts(offer: OfferForDispatch) {
  const alerts = await prisma.alertRule.findMany({ where: { isActive: true } });
  if (alerts.length === 0) return [];
  return alerts.filter((alert) => offerMatchesAlert(offer, alert));
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

export async function dispatchOffer(offer: OfferForDispatch) {
  const channels = await prisma.dispatchChannel.findMany({ where: { isActive: true } });
  const activeAlerts = await prisma.alertRule.count({ where: { isActive: true } });
  const matchedAlerts = await getMatchedAlerts(offer);

  if (activeAlerts > 0 && matchedAlerts.length === 0) {
    await prisma.dispatchLog.create({
      data: {
        offerId: offer.id,
        channel: 'alert-filter',
        status: DispatchStatus.SKIPPED,
        payload: { reason: 'no_alert_match', marketplace: offer.marketplace, score: offer.score }
      }
    });
    return;
  }

  const message = formatOfferMessage(offer);

  for (const channel of channels) {
    try {
      const channelConfig = decryptChannelConfig(channel.config) as ChannelConfig;
      if (channel.type === 'telegram') await sendTelegram(channelConfig, message);
      else if (channel.type === 'whatsapp') await sendWhatsapp(channelConfig, message, offer);
      else if (channel.type === 'evolution') await sendEvolutionWhatsapp(channelConfig, message);
      else if (channel.type === 'webhook') await sendWebhook(channelConfig, { message, offer, matchedAlerts: matchedAlerts.map((alert) => alert.name) });
      else throw new Error(`Canal não suportado: ${channel.type}`);

      await prisma.dispatchLog.create({
        data: {
          offerId: offer.id,
          channel: channel.name,
          status: DispatchStatus.SENT,
          payload: { type: channel.type, matchedAlerts: matchedAlerts.map((alert) => alert.name) }
        }
      });
    } catch (error) {
      await prisma.dispatchLog.create({
        data: {
          offerId: offer.id,
          channel: channel.name,
          status: DispatchStatus.FAILED,
          error: error instanceof Error ? error.message : 'Erro desconhecido'
        }
      });
    }
  }
}

export async function dispatchOffers(offers: OfferForDispatch[]) {
  for (const offer of offers) await dispatchOffer(offer);
}
