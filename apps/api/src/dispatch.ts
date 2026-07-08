import { DispatchStatus } from '@prisma/client';
import { prisma } from './db.js';

type ChannelConfig = Record<string, any>;
type OfferForDispatch = {
  id: string;
  title: string;
  currentPrice: number;
  discountPercent?: number;
  productUrl: string;
  affiliateUrl?: string;
  marketplace: string;
  score: number;
};

function formatOfferMessage(offer: OfferForDispatch) {
  const price = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(offer.currentPrice);
  const discount = offer.discountPercent ? `\n🔥 Desconto: ${offer.discountPercent}% OFF` : '';
  const link = offer.affiliateUrl || offer.productUrl;
  return `🚨 Oferta encontrada!\n\n${offer.title}\n💰 ${price}${discount}\n⭐ Score: ${offer.score}\n🛒 ${link}`;
}

async function sendTelegram(config: ChannelConfig, message: string) {
  const botToken = config.botToken || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = config.chatId || process.env.TELEGRAM_CHANNEL_ID;
  if (!botToken || !chatId) throw new Error('Telegram sem botToken/chatId');

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: false })
  });

  if (!response.ok) throw new Error(`Telegram erro ${response.status}`);
}

async function sendWebhook(config: ChannelConfig, payload: unknown) {
  if (!config.url) throw new Error('Webhook sem URL');
  const response = await fetch(config.url, {
    method: config.method || 'POST',
    headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Webhook erro ${response.status}`);
}

async function sendWhatsapp(config: ChannelConfig, message: string, offer: OfferForDispatch) {
  const url = config.url || process.env.WHATSAPP_PROVIDER_URL;
  const token = config.token || process.env.WHATSAPP_PROVIDER_TOKEN;
  const to = config.to || process.env.WHATSAPP_DEFAULT_TO;
  if (!url || !to) throw new Error('WhatsApp sem URL/destinatário');

  const response = await fetch(url, {
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
  const message = formatOfferMessage(offer);

  for (const channel of channels) {
    try {
      const config = channel.config as ChannelConfig;
      if (channel.type === 'telegram') await sendTelegram(config, message);
      else if (channel.type === 'whatsapp') await sendWhatsapp(config, message, offer);
      else if (channel.type === 'webhook') await sendWebhook(config, { message, offer });
      else throw new Error(`Canal não suportado: ${channel.type}`);

      await prisma.dispatchLog.create({
        data: {
          offerId: offer.id,
          channel: channel.name,
          status: DispatchStatus.SENT,
          payload: { type: channel.type }
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
