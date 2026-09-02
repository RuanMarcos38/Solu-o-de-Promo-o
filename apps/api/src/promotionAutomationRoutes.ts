import { DispatchStatus, Prisma, type Offer } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireEditor } from './auth.js';
import { resolveAffiliateLink } from './affiliate.js';
import { prisma } from './db.js';
import { checkMarketplaceChannelPolicy, formatOfferMessage, type OfferForDispatch } from './dispatchRules.js';
import { fetchExternal } from './http.js';
import { toMarketplaceEnum, toMarketplaceName } from './marketplace.js';
import { decryptChannelConfig } from './secrets.js';

const paramsSchema = z.object({ offerId: z.string().trim().min(1).max(140) });

type ChannelConfig = Record<string, unknown>;

type AiCopyResult = {
  message: string;
  aiUsed: boolean;
  fallbackReason?: string;
};

function marketplaceName(value: Offer['marketplace']) {
  const name = toMarketplaceName(String(value).toLowerCase().replace(/_/g, ''));
  if (!name) throw Object.assign(new Error('Marketplace invalido'), { statusCode: 400 });
  return name;
}

async function findOffer(rawId: string) {
  const direct = await prisma.offer.findUnique({ where: { id: rawId } });
  if (direct) return direct;

  const separatorIndex = rawId.indexOf('-');
  if (separatorIndex < 1) return null;
  const marketplace = toMarketplaceEnum(rawId.slice(0, separatorIndex));
  const externalId = rawId.slice(separatorIndex + 1);
  if (!marketplace || !externalId) return null;

  return prisma.offer.findUnique({
    where: { marketplace_externalId: { marketplace, externalId } }
  });
}

function toDispatchOffer(offer: Offer): OfferForDispatch {
  return {
    id: offer.id,
    title: offer.title,
    currentPrice: Number(offer.currentPrice),
    discountPercent: offer.discountPercent === null ? undefined : Number(offer.discountPercent),
    productUrl: offer.productUrl,
    affiliateUrl: offer.affiliateUrl ?? undefined,
    affiliateEligible: offer.affiliateEligible,
    marketplace: marketplaceName(offer.marketplace),
    score: offer.score
  };
}

function extractChatCompletionText(payload: unknown) {
  if (!payload || typeof payload !== 'object') return undefined;
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : undefined;
}

async function createPromotionCopy(offer: OfferForDispatch): Promise<AiCopyResult> {
  const fallback = formatOfferMessage(offer);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_PROMOTION_MODEL?.trim();
  if (!apiKey || !model) {
    return {
      message: fallback,
      aiUsed: false,
      fallbackReason: 'OPENAI_API_KEY ou OPENAI_PROMOTION_MODEL nao configurado'
    };
  }

  const price = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(offer.currentPrice);
  const discount = offer.discountPercent ? `${offer.discountPercent}%` : 'nao informado';
  const prompt = [
    'Crie uma mensagem curta de promocao para WhatsApp em portugues do Brasil.',
    'Use somente os dados fornecidos. Nao invente beneficios, estoque, prazo, frete, parcelamento ou avaliacao.',
    'Mantenha tom comercial profissional, facil de ler e no maximo 650 caracteres.',
    `Produto: ${offer.title}`,
    `Preco: ${price}`,
    `Desconto: ${discount}`,
    `Score interno: ${offer.score}`,
    `Link afiliado obrigatorio: ${offer.affiliateUrl}`
  ].join('\n');

  try {
    const response = await fetchExternal('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 220,
        messages: [
          {
            role: 'system',
            content: 'Voce redige copies de ofertas usando apenas fatos fornecidos pelo sistema.'
          },
          { role: 'user', content: prompt }
        ]
      })
    }, 15_000);

    if (!response.ok) {
      return { message: fallback, aiUsed: false, fallbackReason: `OpenAI HTTP ${response.status}` };
    }

    let message = extractChatCompletionText(await response.json());
    if (!message) return { message: fallback, aiUsed: false, fallbackReason: 'IA retornou texto vazio' };

    if (!message.includes(String(offer.affiliateUrl))) {
      message = `${message}\n\n🛒 ${offer.affiliateUrl}`;
    }

    return { message: message.slice(0, 900), aiUsed: true };
  } catch (error) {
    return {
      message: fallback,
      aiUsed: false,
      fallbackReason: error instanceof Error ? error.message : 'Falha ao gerar copy com IA'
    };
  }
}

async function sendEvolution(config: ChannelConfig, message: string) {
  const baseUrl = String(config.baseUrl || process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
  const apiKey = String(config.apiKey || process.env.EVOLUTION_API_KEY || '');
  const instanceName = String(config.instanceName || process.env.EVOLUTION_INSTANCE_NAME || '');
  const number = String(config.number || config.to || process.env.WHATSAPP_DEFAULT_TO || '');
  if (!baseUrl || !apiKey || !instanceName || !number) {
    throw new Error('Evolution API sem baseUrl/apiKey/instanceName/number');
  }

  const response = await fetchExternal(`${baseUrl}/message/sendText/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: JSON.stringify({ number, text: message })
  });
  if (!response.ok) throw new Error(`Evolution API erro ${response.status}`);
}

async function sendGenericWhatsapp(config: ChannelConfig, message: string, offer: OfferForDispatch) {
  const url = String(config.url || process.env.WHATSAPP_PROVIDER_URL || '');
  const token = String(config.token || process.env.WHATSAPP_PROVIDER_TOKEN || '');
  const to = String(config.to || config.number || process.env.WHATSAPP_DEFAULT_TO || '');
  if (!url || !to) throw new Error('WhatsApp sem URL/destinatario');

  const response = await fetchExternal(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ to, message, offer })
  });
  if (!response.ok) throw new Error(`WhatsApp provider erro ${response.status}`);
}

async function writeLog(input: {
  offerId: string;
  channel: string;
  status: DispatchStatus;
  error?: string;
  payload: Record<string, unknown>;
}) {
  return prisma.dispatchLog.create({
    data: {
      offerId: input.offerId,
      channel: input.channel,
      status: input.status,
      error: input.error ?? null,
      payload: input.payload as Prisma.InputJsonValue
    }
  });
}

export async function registerPromotionAutomationRoutes(app: FastifyInstance) {
  app.post('/automation/affiliate-whatsapp/:offerId', async (request) => {
    const currentUser = await requireEditor(request);
    const { offerId } = paramsSchema.parse(request.params);
    let offer = await findOffer(offerId);
    if (!offer) throw Object.assign(new Error('Oferta nao encontrada'), { statusCode: 404 });

    if (!offer.affiliateEligible || !offer.affiliateUrl) {
      const resolved = await resolveAffiliateLink({
        marketplace: marketplaceName(offer.marketplace),
        externalId: offer.externalId,
        productUrl: offer.productUrl
      });

      if (!resolved.affiliateEligible || !resolved.affiliateUrl) {
        throw Object.assign(new Error('Marketplace nao retornou link oficial de afiliado para esta oferta'), { statusCode: 409 });
      }

      offer = await prisma.offer.update({
        where: { id: offer.id },
        data: {
          affiliateEligible: true,
          affiliateUrl: resolved.affiliateUrl,
          affiliateProvider: resolved.affiliateProvider,
          affiliateVerifiedAt: resolved.affiliateVerifiedAt ?? new Date()
        }
      });
    }

    const dispatchOffer = toDispatchOffer(offer);
    const copy = await createPromotionCopy(dispatchOffer);
    const channels = await prisma.dispatchChannel.findMany({
      where: { isActive: true, type: { in: ['whatsapp', 'evolution'] } },
      orderBy: { createdAt: 'asc' }
    });

    if (channels.length === 0) {
      throw Object.assign(new Error('Nenhum grupo/canal WhatsApp ou Evolution ativo configurado'), { statusCode: 409 });
    }

    const sent: string[] = [];
    const blocked: Array<{ channel: string; reason: string }> = [];
    const failed: Array<{ channel: string; error: string }> = [];

    for (const channel of channels) {
      const channelConfig = decryptChannelConfig(channel.config);
      const policy = checkMarketplaceChannelPolicy(dispatchOffer, channel.type, channelConfig);
      if (!policy.allowed) {
        blocked.push({ channel: channel.name, reason: policy.reason });
        await writeLog({
          offerId: offer.id,
          channel: channel.name,
          status: DispatchStatus.SKIPPED,
          payload: {
            source: 'affiliate-whatsapp-automation',
            reason: policy.reason,
            channelId: channel.id,
            marketplace: dispatchOffer.marketplace,
            requestedBy: currentUser.id,
            aiUsed: copy.aiUsed
          }
        });
        continue;
      }

      try {
        if (channel.type === 'evolution' || channelConfig.provider === 'evolution' || channelConfig.baseUrl || channelConfig.instanceName) {
          await sendEvolution(channelConfig, copy.message);
        } else {
          await sendGenericWhatsapp(channelConfig, copy.message, dispatchOffer);
        }
        sent.push(channel.name);
        await writeLog({
          offerId: offer.id,
          channel: channel.name,
          status: DispatchStatus.SENT,
          payload: {
            source: 'affiliate-whatsapp-automation',
            channelId: channel.id,
            marketplace: dispatchOffer.marketplace,
            requestedBy: currentUser.id,
            aiUsed: copy.aiUsed,
            sentAt: new Date().toISOString()
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro desconhecido';
        failed.push({ channel: channel.name, error: message });
        await writeLog({
          offerId: offer.id,
          channel: channel.name,
          status: DispatchStatus.FAILED,
          error: message,
          payload: {
            source: 'affiliate-whatsapp-automation',
            channelId: channel.id,
            marketplace: dispatchOffer.marketplace,
            requestedBy: currentUser.id,
            aiUsed: copy.aiUsed,
            failedAt: new Date().toISOString()
          }
        });
      }
    }

    return {
      offer: {
        id: offer.id,
        marketplace: dispatchOffer.marketplace,
        title: offer.title,
        affiliateEligible: offer.affiliateEligible,
        affiliateUrl: offer.affiliateUrl,
        affiliateProvider: offer.affiliateProvider
      },
      ai: { used: copy.aiUsed, fallbackReason: copy.fallbackReason },
      message: copy.message,
      sent,
      blocked,
      failed
    };
  });
}
